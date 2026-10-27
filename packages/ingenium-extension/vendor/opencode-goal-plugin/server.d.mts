declare const plugin: { id: string; setup: (ctx: unknown) => Promise<() => Promise<void>> };
export default plugin;
