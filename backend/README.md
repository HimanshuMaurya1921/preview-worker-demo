# 📡 AI Generation Backend (Simulator)

This component simulates the AI engine that generates the Next.js application structure. It provides a REST API that returns a flat file map, which the frontend then patches into the WebContainer.

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Start the Server
```bash
npm start
```
The server will be available at `http://localhost:3000`.

---

## 🛠️ API Reference

### `GET /api/files`
Returns the complete file structure for the AI-generated application.

**Response Schema:**
```json
{
  "files": {
    "app/page.js": "export default function Home() { ... }",
    "app/layout.js": "...",
    "components/Header.js": "...",
    "styles/globals.css": "..."
  }
}
```

---

## 🧪 Simulation Logic
The backend cycles through predefined templates or generates responses based on simulated "prompts" to test the frontend's ability to handle differential updates and HMR stability.

### Key Files
- `index.js`: Main Express server and endpoint definitions.
- `templates/`: Directory containing various Next.js project states for testing.
