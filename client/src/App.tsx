/** Design system: 精密觀測站；固定使用淺色鈦白介面，讓深色鏡頭舞台保有最高對比；支援 GitHub Pages 子路徑。 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

const appBase = import.meta.env.BASE_URL.replace(/\/$/, "");

function Routes() {
  return <Switch><Route path="/" component={Home} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><WouterRouter base={appBase}><Routes /></WouterRouter></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
