import { Navigate, Route, Routes } from "react-router-dom";
import { TemplatesPage } from "./pages/TemplatesPage";
import { TemplateAdvancedPage } from "./pages/TemplateAdvancedPage";
import { GeneratePage } from "./pages/GeneratePage";

export default function App() {
  return (
    <div className="min-h-full">
      <Routes>
        <Route path="/" element={<Navigate to="/templates" replace />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/:templateId/advanced" element={<TemplateAdvancedPage />} />
        <Route path="/generate/:templateId" element={<GeneratePage />} />
      </Routes>
    </div>
  );
}
