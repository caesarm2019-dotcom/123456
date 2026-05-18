import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const saValue = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    if (saValue.startsWith('{')) {
      const serviceAccount = JSON.parse(saValue);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase Admin initialized");
    } else {
      console.warn("FIREBASE_SERVICE_ACCOUNT environment variable exists but does not appear to be a JSON string. Skipping Firebase Admin initialization.");
    }
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error);
  }
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY as string,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/api/ai/suggest-price", async (req, res) => {
    const { itemTitle, category, condition, itemDescription } = req.body;

    if (!itemTitle) {
      return res.status(400).json({ error: "Item title is required" });
    }

    try {
      const prompt = `You are a professional market price analyst for second-hand items in Iraq.
      Given the following details, suggest a fair market price range in Iraqi Dinar (IQD).
      Item: ${itemTitle}
      Category: ${category}
      Condition: ${condition}
      Description: ${itemDescription}

      Respond with a JSON object containing:
      - minPrice: number
      - maxPrice: number
      - reasoning: string (briefly in Arabic)
      - marketTrend: string (optional, brief in Arabic)

      Do not include any other text in the response, only the JSON.`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      const suggestion = JSON.parse(result.text);
      res.json(suggestion);
    } catch (error) {
      console.error("Gemini Error:", error);
      res.status(500).json({ error: "Failed to generate price suggestion" });
    }
  });

  app.post("/api/notifications/send", async (req, res) => {
    const { token, title, body, data } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Registration token is required" });
    }

    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      return res.status(501).json({ error: "FCM not configured on server" });
    }

    try {
      const message = {
        notification: { title, body },
        data: data || {},
        token: token
      };

      const response = await admin.messaging().send(message);
      res.json({ success: true, messageId: response });
    } catch (error) {
      console.error("FCM Error:", error);
      res.status(500).json({ error: "Failed to send notification" });
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
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
