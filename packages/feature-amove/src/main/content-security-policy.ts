const sharedDirectives = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
];

export function contentSecurityPolicy(rendererUrl?: string): string {
  const scriptDirective = rendererUrl
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self'";
  const connectDirective = rendererUrl
    ? `connect-src 'self' ${webSocketOrigin(rendererUrl)}`
    : "connect-src 'none'";

  return [sharedDirectives[0], scriptDirective, ...sharedDirectives.slice(1, 4), connectDirective, ...sharedDirectives.slice(4)].join("; ");
}

function webSocketOrigin(rendererUrl: string): string {
  const url = new URL(rendererUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}`;
}
