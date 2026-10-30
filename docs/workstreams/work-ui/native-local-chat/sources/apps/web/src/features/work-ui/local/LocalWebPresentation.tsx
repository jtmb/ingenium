import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { NativeWorkPresentation } from "../NativeWorkPresentation";
import type { LocalWebController, WebBounds } from "./local-web-controller.mjs";

export function LocalWebPresentation({ controller, scope, projectName, children }: {
  controller: LocalWebController | null; scope: string; projectName: string; children: ReactNode;
}) {
  return controller ? <BoundWebPresentation key={scope} controller={controller} projectName={projectName}>{children}</BoundWebPresentation>
    : <NativeWorkPresentation scope={scope} projectName={projectName} hasWorkspace={false}>{children}</NativeWorkPresentation>;
}
function BoundWebPresentation({ controller, projectName, children }: {
  controller: LocalWebController; projectName: string; children: ReactNode;
}) {
  const id = useId(), anchor = useRef<HTMLDivElement>(null);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const pendingEnter = useRef(false), live = useRef(true), lifetime = useRef(0), activeController = useRef(controller);
  activeController.current = controller;
  const bounds = (): WebBounds => {
    if (!anchor.current) throw Error("The Web viewport is unavailable.");
    const value = anchor.current.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height, viewport_width: window.innerWidth, viewport_height: window.innerHeight };
  };
  useLayoutEffect(() => {
    live.current = true;
    lifetime.current++;
    return () => {
      live.current = false; const closed = ++lifetime.current;
      queueMicrotask(() => { if (lifetime.current === closed || activeController.current !== controller) void controller.dispose().catch(() => { /* mandatory cleanupFailure callback owns the retained native handle */ }); });
    };
  }, [controller]);
  useLayoutEffect(() => {
    if (snapshot.view !== "web" || !anchor.current) return;
    const resize = () => { if (!live.current) return; void controller.resize(bounds()).catch(() => { /* controller retains truthful error/pending state */ }); };
    const observer = new ResizeObserver(resize); observer.observe(anchor.current);
    window.addEventListener("resize", resize); window.addEventListener("scroll", resize, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); window.removeEventListener("scroll", resize, true); };
  }, [controller, snapshot.view]);
  const web = async () => {
    if (pendingEnter.current || snapshot.busy || snapshot.pending) return;
    pendingEnter.current = true;
    // DOM host slot is already mounted; only the original native authority can show a child.
    try { await controller.enter(bounds()); } catch { /* controller publishes the actual failure */ }
    finally { pendingEnter.current = false; }
  };
  return <section className="native-work-presentation" aria-label="Work conversation">
    <header className="native-work-heading">
      <span className="native-work-project">{projectName}</span>
      <div role="group" aria-label="Conversation presentation" className="native-work-switch">
        <button type="button" aria-pressed={snapshot.view === "work"} aria-controls={`${id}-work`} disabled={snapshot.busy || Boolean(snapshot.pending)} onClick={() => { void controller.work().catch(() => {}); }}>Work</button>
        <button type="button" aria-pressed={snapshot.view === "web"} aria-controls={`${id}-web`} disabled={snapshot.busy || Boolean(snapshot.pending)} onClick={() => { void web(); }}>Web</button>
      </div>
    </header>
    {snapshot.error && <p role="alert">{snapshot.error}</p>}
    {snapshot.pending && !snapshot.busy && <button type="button" onClick={() => { void controller.check().catch(() => {}); }}>Check Web view status</button>}
    <div className="native-work-viewport">
      <div id={`${id}-work`} className="native-work-surface" role="region" aria-label="Native Work presentation" aria-hidden={snapshot.view !== "work"} inert={snapshot.view !== "work"} data-active={snapshot.view === "work"}>{children}</div>
      <div id={`${id}-web`} ref={anchor} className="native-work-surface" role="region" aria-label="Upstream Web presentation" aria-hidden={snapshot.view !== "web"} inert={snapshot.view !== "web"} data-active={snapshot.view === "web"}>
        {snapshot.busy && <p role="status">Opening Web conversation…</p>}
        {snapshot.error && !snapshot.pending && <button type="button" onClick={() => { void controller.work().catch(() => {}); }}>Return to Work</button>}
      </div>
    </div>
  </section>;
}
