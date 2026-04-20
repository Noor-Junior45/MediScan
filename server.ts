import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
  app.use(express.json({ limit: '10mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "DawaLens AI Server is running" });
  });

  // Extraction Cache Routes
  app.post("/api/ai/extract-cache", async (req, res) => {
    try {
      const { imageHash } = req.body;
      const { getExtractionCache } = await import("./server/aiService.js");
      const result = await getExtractionCache(imageHash);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/ai/extract-save-cache", async (req, res) => {
    try {
      const { imageHash, data } = req.body;
      const { saveExtractionCache } = await import("./server/aiService.js");
      await saveExtractionCache(imageHash, data);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Interaction Cache Routes
  app.post("/api/ai/interactions-cache", async (req, res) => {
    try {
      const { key } = req.body;
      const { getInteractionCache } = await import("./server/aiService.js");
      const result = await getInteractionCache(key);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/ai/interactions-save-cache", async (req, res) => {
    try {
      const { key, data } = req.body;
      const { saveInteractionCache } = await import("./server/aiService.js");
      await saveInteractionCache(key, data);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
