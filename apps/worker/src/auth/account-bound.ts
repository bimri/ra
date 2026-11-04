/** Bind a request to the local account which prepared it, before private work. */
export function accountMatches(request: Request, authenticated: string): boolean {
  const query = new URL(request.url).searchParams.getAll("account");
  const header = request.headers.get("x-ra-account");
  return query.length <= 1 && (query.length === 0 || query[0] === authenticated) && (header === null || header === authenticated);
}
