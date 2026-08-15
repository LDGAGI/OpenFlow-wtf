export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 })
}
