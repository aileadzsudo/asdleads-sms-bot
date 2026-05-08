import { Frame } from "./components/Frame";
import { Sidebar } from "./components/Sidebar";
import { Today } from "./pages/Today";

function activeRoute(pathname: string) {
  const part = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  return part || "overview";
}

export function App() {
  const active = activeRoute(window.location.pathname);

  return (
    <Frame>
      <Sidebar active={active} />
      <Today />
    </Frame>
  );
}
