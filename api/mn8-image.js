export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sourceUrl = "https://mn8.pl/image";
  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OdKonopiarzaAvailability/1.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      return res.status(502).json({
        error: "MN8 source returned an error",
        sourceStatus: response.status,
        source: sourceUrl
      });
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return res.status(502).json({
        error: "MN8 response was not an image",
        contentType
      });
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-Source-URL", sourceUrl);
    res.setHeader("X-Source-Checked-At", new Date().toISOString());
    return res.status(200).send(bytes);
  } catch (error) {
    return res.status(502).json({
      error: "Could not reach MN8 source",
      message: String(error?.message || error),
      source: sourceUrl
    });
  }
}
