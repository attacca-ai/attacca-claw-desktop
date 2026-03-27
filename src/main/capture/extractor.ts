/**
 * URL/YouTube content extraction — ported from relay-server/src/routes/capture.ts.
 * Dependencies: @mozilla/readability, jsdom, youtube-transcript
 */

interface ExtractionResult {
  success: boolean
  type?: 'youtube' | 'article'
  title?: string
  text?: string
  wordCount?: number
  error?: string
}

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com\/watch|youtu\.be\//.test(url)
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/[?&]v=([^&]+)/) ?? url.match(/youtu\.be\/([^?&]+)/)
  return m ? m[1] : null
}

export async function extractUrl(url: string): Promise<ExtractionResult> {
  if (!url) return { success: false, error: 'url required' }

  // YouTube transcript extraction
  if (isYouTubeUrl(url)) {
    const videoId = extractYouTubeId(url)
    if (!videoId) {
      return { success: false, error: 'No se pudo extraer el ID del video de YouTube' }
    }
    try {
      const { YoutubeTranscript } = await import('youtube-transcript')
      const transcript = await YoutubeTranscript.fetchTranscript(videoId)
      const text = transcript.map((t: { text: string }) => t.text).join(' ')

      let title = `YouTube ${videoId}`
      try {
        const oembed = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
        )
        if (oembed.ok) {
          const data = (await oembed.json()) as { title?: string }
          if (data.title) title = data.title
        }
      } catch {
        // title stays as fallback
      }

      return { success: true, type: 'youtube', title, text, wordCount: text.split(/\s+/).length }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { success: false, error: `Transcripcion de YouTube no disponible: ${msg}` }
    }
  }

  // Regular URL: fetch + Readability
  try {
    const { Readability } = await import('@mozilla/readability')
    const { JSDOM } = await import('jsdom')

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Attacca/1.0; +https://attacca.app)' },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status} al acceder a la URL` }
    }

    const html = await response.text()
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article?.textContent?.trim()) {
      return { success: false, error: 'No se pudo extraer contenido legible de esta pagina' }
    }

    const text = article.textContent.trim()
    return {
      success: true,
      type: 'article',
      title: article.title ?? url,
      text,
      wordCount: text.split(/\s+/).length
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: `No se pudo acceder a la URL: ${msg}` }
  }
}
