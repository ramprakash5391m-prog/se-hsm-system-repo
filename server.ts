import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const PYTHON_PORT = Number(process.env.PYTHON_PORT || 5001);

let pythonProcess: ChildProcess | null = null;

function startPythonBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const pyScript = path.join(__dirname, 'backend', 'server.py');
    pythonProcess = spawn('python3', [pyScript], {
      cwd: __dirname,
      env: { ...process.env, PYTHON_PORT: String(PYTHON_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pythonProcess.stdout?.on('data', (chunk) => {
      process.stdout.write(`[python] ${chunk.toString()}`);
    });
    pythonProcess.stderr?.on('data', (chunk) => {
      process.stderr.write(`[python] ${chunk.toString()}`);
    });
    pythonProcess.on('exit', (code) => {
      console.error(`[python] process exited with code ${code}`);
    });

    const deadline = Date.now() + 10_000;
    const checkHealth = () => {
      const req = http.get(`http://127.0.0.1:${PYTHON_PORT}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else if (Date.now() < deadline) {
          setTimeout(checkHealth, 150);
        } else {
          reject(new Error('Python backend failed health check.'));
        }
      });
      req.on('error', () => {
        if (Date.now() < deadline) {
          setTimeout(checkHealth, 150);
        } else {
          reject(new Error('Timed out waiting for Python backend.'));
        }
      });
    };
    checkHealth();
  });
}

function proxyToPython(req: express.Request, res: express.Response): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: PYTHON_PORT,
    path: req.originalUrl,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${PYTHON_PORT}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: `Python API unavailable: ${err.message}` });
    }
  });

  req.pipe(proxyReq, { end: true });
}

async function startServer() {
  await startPythonBackend();

  const app = express();
  app.use('/api', proxyToPython);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`MedCore HMS gateway listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    server.close();
    if (pythonProcess && !pythonProcess.killed) {
      pythonProcess.kill('SIGTERM');
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  if (pythonProcess && !pythonProcess.killed) {
    pythonProcess.kill('SIGTERM');
  }
  process.exit(1);
});
