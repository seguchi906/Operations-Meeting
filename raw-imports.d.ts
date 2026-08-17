/// <reference types="@cloudflare/workers-types" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "cloudflare:workers" {
  export const env: Record<string, any>;
}
