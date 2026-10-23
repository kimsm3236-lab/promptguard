/** Browser-only document extraction. Never upload or persist source bytes. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_TEXT_LENGTH = 1_000_000
export const MAX_PAGES = 100
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024
export const EXTRACTION_NOTE =
  '추출한 텍스트만 검사합니다. 원본 파일의 서식·이미지·메타데이터는 가려지지 않으며, 결과는 TXT로 저장됩니다. 문서 내부 이미지와 애니메이션의 추가 프레임은 검사하지 않습니다. OCR은 글자나 숫자를 잘못 읽을 수 있으니 원본과 대조해 주세요.'
export type ReadOptions = {
  signal: AbortSignal
  onProgress: (status: string) => void
  pdfOcr: boolean
}
export type ReadResult = { text: string; usedOcr: boolean }

function check(signal: AbortSignal) {
  signal.throwIfAborted()
}
function bounded(text: string) {
  if (text.length > MAX_TEXT_LENGTH)
    throw new Error(
      '추출한 글자가 100만 자를 넘습니다. 문서를 나누어 선택해 주세요.',
    )
  return text
}
function tidy(text: string) {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // RTF and binary document streams can contain non-printing controls.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .trim()
  )
}
export function decodeText(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(data)
  if (data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be').decode(data)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('euc-kr').decode(data)
  }
}
function xmlDocument(source: string) {
  const xml = new DOMParser().parseFromString(source, 'application/xml')
  if (xml.getElementsByTagName('parsererror').length)
    throw new Error('문서 구조가 손상되어 읽을 수 없습니다.')
  return xml
}
/** Parse as inert XML; do not insert uploaded markup into the page. */
export function xmlText(source: string): string {
  const doc = xmlDocument(source)
  function walk(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? ''
    if (!(node instanceof Element))
      return Array.from(node.childNodes).map(walk).join('')
    if (['script', 'style', 'binary-data'].includes(node.localName)) return ''
    if (['tab'].includes(node.localName)) return '\t'
    if (['br', 'line-break'].includes(node.localName)) return '\n'
    const value = Array.from(node.childNodes).map(walk).join('')
    return (
      value +
      (['p', 'h', 'tr', 'row', 'table-row', 'section', 'div', 'li'].includes(
        node.localName,
      )
        ? '\n'
        : ['tc', 'table-cell'].includes(node.localName)
          ? '\t'
          : '')
    )
  }
  return tidy(walk(doc))
}
async function archiveText(
  bytes: Uint8Array,
  extension: string,
): Promise<string> {
  const { unzipSync } = await import('fflate')
  let expanded = 0
  const files = unzipSync(bytes, {
    filter: (entry) => {
      // Only decode text-bearing XML; never decompress embedded images or binaries.
      const wanted =
        extension === 'docx'
          ? /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i.test(
              entry.name,
            )
          : extension === 'pptx'
            ? /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i.test(
                entry.name,
              )
            : extension === 'hwpx'
              ? /^Contents\/section\d+\.xml$/i.test(entry.name)
              : /^(content\.xml|META-INF\/container\.xml)$|\.(xhtml|html|opf)$/i.test(
                  entry.name,
                )
      if (wanted) {
        expanded += entry.originalSize
        if (expanded > MAX_EXPANDED_BYTES)
          throw new Error(
            '압축 해제한 문서가 100MB를 넘습니다. 문서를 나누어 주세요.',
          )
      }
      return wanted
    },
  })
  let names = Object.keys(files).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
  if (extension === 'epub') {
    const container = files['META-INF/container.xml']
    if (!container) throw new Error('EPUB 문서 구조를 읽지 못했습니다.')
    const root = xmlDocument(decodeText(container))
      .getElementsByTagName('rootfile')[0]
      ?.getAttribute('full-path')
    if (!root || !files[root]) throw new Error('EPUB 목차를 읽지 못했습니다.')
    const opf = xmlDocument(decodeText(files[root]))
    const manifest = new Map(
      Array.from(opf.getElementsByTagName('item')).map((item) => [
        item.getAttribute('id'),
        item.getAttribute('href'),
      ]),
    )
    const base = root.includes('/')
      ? root.slice(0, root.lastIndexOf('/') + 1)
      : ''
    names = Array.from(opf.getElementsByTagName('itemref')).map((item) => {
      const href = manifest.get(item.getAttribute('idref'))
      return href
        ? decodeURIComponent(
            new URL(base + href, 'https://document.invalid/').pathname.slice(1),
          )
        : ''
    })
  }
  let text = ''
  for (const name of names) {
    if (!files[name] || (/\.(opf|xml)$/i.test(name) && extension === 'epub'))
      continue
    text += xmlText(decodeText(files[name])) + '\n\n'
    bounded(text)
  }
  return text
}

async function legacyText(
  bytes: Uint8Array,
  extension: string,
): Promise<string> {
  const CFB = await import('cfb')
  const container = CFB.read(bytes, { type: 'array' })
  function stream(name: string) {
    const entry = CFB.find(container, name)
    if (!entry)
      throw new Error(
        '문서의 본문을 찾지 못했습니다. 최신 문서 형식이나 PDF로 변환해 주세요.',
      )
    return Uint8Array.from(entry.content)
  }
  if (extension === 'hwp') {
    const header = stream('FileHeader')
    const flags = new DataView(header.buffer).getUint32(36, true)
    if (flags & (2 | 4))
      throw new Error(
        '암호화·배포용 한글 문서는 지원하지 않습니다. 보호를 해제하거나 PDF로 변환해 주세요.',
      )
    const sections = container.FullPaths.map((path, index) => ({ path, index }))
      .filter((item) => /\/BodyText\/Section\d+$/i.test(item.path))
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true }),
      )
    const { Inflate } = await import('fflate')
    let total = 0
    let text = ''
    for (const section of sections) {
      let data = Uint8Array.from(container.FileIndex[section.index].content)
      if (flags & 1) {
        const chunks: Uint8Array[] = []
        const inflater = new Inflate((chunk) => {
          total += chunk.length
          if (total > MAX_EXPANDED_BYTES)
            throw new Error('압축 해제한 문서가 100MB를 넘습니다.')
          chunks.push(chunk)
        })
        inflater.push(data, true)
        const output = new Uint8Array(
          chunks.reduce((n, chunk) => n + chunk.length, 0),
        )
        let offset = 0
        for (const chunk of chunks) {
          output.set(chunk, offset)
          offset += chunk.length
        }
        data = output
      }
      text += hwpRecords(data) + '\n'
      bounded(text)
    }
    return text
  }
  if (extension === 'doc') {
    const word = stream('WordDocument')
    const view = new DataView(word.buffer, word.byteOffset, word.byteLength)
    if (view.getUint16(10, true) & 0x8100)
      throw new Error('암호화된 Word 문서는 보호를 해제해 주세요.')
    const table = stream(view.getUint16(10, true) & 0x200 ? '1Table' : '0Table')
    // Word 97–2003 CLX piece table; preserve mixed Unicode/compressed runs.
    let pos = view.getUint32(0x1a2, true)
    while (table[pos] === 1)
      pos += 3 + new DataView(table.buffer).getUint16(pos + 1, true)
    if (table[pos] !== 2)
      throw new Error(
        '이 Word 형식은 읽을 수 없습니다. DOCX나 PDF로 변환해 주세요.',
      )
    const tableView = new DataView(
      table.buffer,
      table.byteOffset,
      table.byteLength,
    )
    const size = tableView.getUint32(pos + 1, true)
    const count = (size - 4) / 12
    if (!Number.isInteger(count) || count < 0 || pos + 5 + size > table.length)
      throw new Error('Word 문서 구조가 손상되었습니다.')
    pos += 5
    let text = ''
    for (let i = 0; i < count; i++) {
      const length =
        tableView.getUint32(pos + (i + 1) * 4, true) -
        tableView.getUint32(pos + i * 4, true)
      const location = tableView.getUint32(
        pos + (count + 1) * 4 + i * 8 + 2,
        true,
      )
      const compressed = !!(location & 0x40000000)
      const start = (location & 0x3fffffff) / (compressed ? 2 : 1)
      const end = start + length * (compressed ? 1 : 2)
      if (end > word.length) throw new Error('Word 본문이 손상되었습니다.')
      text += new TextDecoder(compressed ? 'windows-1252' : 'utf-16le').decode(
        word.subarray(start, end),
      )
      bounded(text)
    }
    return text
  }
  const ppt = stream('PowerPoint Document')
  const view = new DataView(ppt.buffer, ppt.byteOffset, ppt.byteLength)
  function records(start: number, end: number, depth = 0): string {
    if (depth > 30)
      throw new Error(
        '문서 구조가 너무 복잡합니다. PPTX나 PDF로 변환해 주세요.',
      )
    let text = ''
    for (let pos = start; pos + 8 <= end;) {
      const info = view.getUint16(pos, true),
        type = view.getUint16(pos + 2, true),
        size = view.getUint32(pos + 4, true)
      const next = pos + 8 + size
      if (next > end) throw new Error('PowerPoint 문서 구조가 손상되었습니다.')
      if ((info & 15) === 15) text += records(pos + 8, next, depth + 1)
      else if (type === 4000 || type === 4008)
        text +=
          new TextDecoder(type === 4000 ? 'utf-16le' : 'windows-1252').decode(
            ppt.subarray(pos + 8, next),
          ) + '\n'
      bounded(text)
      pos = next
    }
    return text
  }
  return records(0, ppt.length)
}
export function hwpRecords(data: Uint8Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let text = ''
  for (let pos = 0; pos + 4 <= data.length;) {
    const header = view.getUint32(pos, true),
      tag = header & 0x3ff
    let size = header >>> 20
    pos += 4
    if (size === 0xfff) {
      size = view.getUint32(pos, true)
      pos += 4
    }
    if (pos + size > data.length)
      throw new Error('한글 문서 구조가 손상되었습니다.')
    if (tag === 67) {
      for (let i = pos; i + 1 < pos + size; i += 2) {
        const code = view.getUint16(i, true)
        if (code === 9) {
          text += '\t'
          i += 14
        } else if (code === 10 || code === 13) text += '\n'
        else if (
          (code >= 1 && code <= 8) ||
          (code >= 11 && code <= 12) ||
          (code >= 14 && code <= 23)
        )
          i += 14
        else if (code >= 32) text += String.fromCharCode(code)
      }
      text += '\n'
      bounded(text)
    }
    pos += size
  }
  return text
}

async function makeOcr(options: ReadOptions) {
  const { createWorker } = await import('tesseract.js')
  check(options.signal)
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined
  let rejectInitialization: (error: Error) => void = () => {}
  const initializationFailure = new Promise<never>((_, reject) => {
    rejectInitialization = reject
  })
  let initializationFinished = false
  const stop = () => {
    rejectInitialization(new DOMException('취소됨', 'AbortError'))
    void worker?.terminate()
  }
  options.signal.addEventListener('abort', stop, { once: true })
  options.onProgress(
    '한국어·영어 문자 인식 준비 중… (첫 사용 시 시간이 걸릴 수 있어요)',
  )
  const timeout = window.setTimeout(
    () =>
      rejectInitialization(
        new Error(
          '문자 인식 엔진을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
        ),
      ),
    120_000,
  )
  try {
    const pending = createWorker(['kor', 'eng'], 1, {
      workerPath: `${import.meta.env.BASE_URL}vendor/ocr/worker.min.js`,
      corePath: `${import.meta.env.BASE_URL}vendor/ocr/core`,
      langPath: `${import.meta.env.BASE_URL}vendor/ocr`,
      cacheMethod: 'none', // Do not use IndexedDB or persist recognized content.
      logger: (status) => {
        if (!options.signal.aborted && status.status === 'recognizing text')
          options.onProgress(
            `글자 인식 중… ${Math.round(status.progress * 100)}%`,
          )
      },
      errorHandler: () =>
        rejectInitialization(
          new Error(
            '문자 인식에 실패했습니다. 파일을 확인한 뒤 다시 시도해 주세요.',
          ),
        ),
    })
    // Dispose an engine that finishes loading after cancellation or failure.
    void pending.then(
      (lateWorker) => {
        if (initializationFinished && worker !== lateWorker)
          void lateWorker.terminate()
      },
      () => {},
    )
    worker = await Promise.race([pending, initializationFailure])
    check(options.signal)
  } catch (error) {
    options.signal.removeEventListener('abort', stop)
    await worker?.terminate()
    throw error
  } finally {
    initializationFinished = true
    window.clearTimeout(timeout)
  }
  const activeWorker = worker
  return {
    recognize: async (image: HTMLCanvasElement) => {
      check(options.signal)
      // Termination does not settle all library jobs; explicitly race cancellation.
      let onAbort: () => void = () => {}
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('취소됨', 'AbortError'))
        options.signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        return (await Promise.race([activeWorker.recognize(image), aborted]))
          .data.text
      } finally {
        options.signal.removeEventListener('abort', onAbort)
      }
    },
    close: async () => {
      options.signal.removeEventListener('abort', stop)
      await activeWorker.terminate()
    },
  }
}
function canvasFor(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 50_000_000
  )
    throw new Error(
      '이미지가 너무 크거나 손상되었습니다. 5천만 화소 이하로 줄여 주세요.',
    )
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 3000 / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  return canvas
}
async function imageText(file: File, options: ReadOptions) {
  const ocr = await makeOcr(options)
  try {
    if (/\.tiff?$/i.test(file.name)) {
      const UTIF = await import('utif')
      const buffer = await file.arrayBuffer()
      const pages = UTIF.decode(buffer)
      if (pages.length > MAX_PAGES)
        throw new Error(
          'TIFF는 최대 100페이지까지 처리합니다. 파일을 나누어 주세요.',
        )
      let text = ''
      for (const page of pages) {
        check(options.signal)
        const width = Number(Array.isArray(page.t256) ? page.t256[0] : 0),
          height = Number(Array.isArray(page.t257) ? page.t257[0] : 0)
        const canvas = canvasFor(width, height)
        UTIF.decodeImage(buffer, page)
        const source = document.createElement('canvas')
        source.width = width
        source.height = height
        source
          .getContext('2d')!
          .putImageData(
            new ImageData(
              new Uint8ClampedArray(UTIF.toRGBA8(page)),
              width,
              height,
            ),
            0,
            0,
          )
        canvas
          .getContext('2d')!
          .drawImage(source, 0, 0, canvas.width, canvas.height)
        text += (await ocr.recognize(canvas)) + '\n\n'
        source.width = source.height = canvas.width = canvas.height = 0
        bounded(text)
      }
      return text
    }
    const image = await createImageBitmap(file)
    try {
      const canvas = canvasFor(image.width, image.height)
      canvas
        .getContext('2d')!
        .drawImage(image, 0, 0, canvas.width, canvas.height)
      try {
        return await ocr.recognize(canvas)
      } finally {
        canvas.width = canvas.height = 0
      }
    } finally {
      image.close()
    }
  } finally {
    await ocr.close()
  }
}
async function pdfText(
  bytes: Uint8Array,
  options: ReadOptions,
): Promise<ReadResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}vendor/pdf/pdf.worker.min.mjs`
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: `${import.meta.env.BASE_URL}vendor/pdf/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}vendor/pdf/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}vendor/pdf/wasm/`,
    useSystemFonts: true,
  })
  const stop = () => {
    void task.destroy()
  }
  options.signal.addEventListener('abort', stop, { once: true })
  let ocr: Awaited<ReturnType<typeof makeOcr>> | undefined
  try {
    const pdf = await task.promise
    if (pdf.numPages > MAX_PAGES)
      throw new Error(
        'PDF는 최대 100페이지까지 처리합니다. 파일을 나누어 주세요.',
      )
    let text = '',
      usedOcr = false
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      check(options.signal)
      options.onProgress(`PDF ${pageNumber}/${pdf.numPages}페이지 읽는 중…`)
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const native = content.items
        .map((item) =>
          'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
        )
        .join('')
      text += `\n[${pageNumber}페이지]\n` + native
      // OCR every page when enabled, including pages mixing text and images.
      if (options.pdfOcr) {
        ocr ??= await makeOcr(options)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({
          scale: Math.min(2, 3000 / Math.max(base.width, base.height)),
        })
        const canvas = canvasFor(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        )
        const render = page.render({ canvas, viewport })
        const cancelRender = () => render.cancel()
        options.signal.addEventListener('abort', cancelRender, { once: true })
        try {
          await render.promise
          const recognized = await ocr.recognize(canvas)
          text += native.trim()
            ? '\n[페이지 이미지 OCR · 본문과 중복될 수 있어요]\n' + recognized
            : recognized
          usedOcr = true
        } finally {
          options.signal.removeEventListener('abort', cancelRender)
          canvas.width = canvas.height = 0
        }
      }
      page.cleanup()
      bounded(text)
    }
    return { text, usedOcr }
  } finally {
    options.signal.removeEventListener('abort', stop)
    await ocr?.close()
    await task.destroy()
  }
}

export async function readDocument(
  file: File,
  options: ReadOptions,
): Promise<ReadResult> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error(
      '파일당 최대 50MB까지 읽을 수 있습니다. 파일을 나누거나 용량을 줄여 주세요.',
    )
  if (!file.size)
    throw new Error('빈 파일입니다. 내용이 있는 파일을 선택해 주세요.')
  check(options.signal)
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  options.onProgress('파일을 이 기기에서 읽는 중…')
  const bytes = new Uint8Array(await file.arrayBuffer())
  check(options.signal)
  let result: ReadResult
  if (extension === 'pdf') result = await pdfText(bytes, options)
  else if (/^(png|jpe?g|webp|bmp|gif|tiff?)$/.test(extension))
    result = { text: await imageText(file, options), usedOcr: true }
  else if (/^(xlsx|xls|xlsm|xlsb|ods)$/.test(extension)) {
    // Check ZIP expansion before passing OOXML to the spreadsheet decoder.
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const { unzipSync } = await import('fflate')
      let expanded = 0
      unzipSync(bytes, {
        filter: (entry) => {
          expanded += entry.originalSize
          if (expanded > MAX_EXPANDED_BYTES)
            throw new Error('압축 해제한 문서가 100MB를 넘습니다.')
          return false
        },
      })
    }
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(bytes, {
      type: 'array',
      cellHTML: false,
      cellFormula: false,
      cellStyles: false,
      bookVBA: false,
    })
    let text = ''
    for (const name of workbook.SheetNames) {
      text +=
        `[${name}]\n` +
        XLSX.utils.sheet_to_csv(workbook.Sheets[name], {
          FS: '\t',
          blankrows: false,
        }) +
        '\n\n'
      bounded(text)
    }
    result = { text, usedOcr: false }
  } else if (/^(docx|pptx|hwpx|odt|odp|epub)$/.test(extension))
    result = { text: await archiveText(bytes, extension), usedOcr: false }
  else if (/^(hwp|doc|ppt)$/.test(extension))
    result = { text: await legacyText(bytes, extension), usedOcr: false }
  else {
    const source = decodeText(bytes)
    if (extension === 'rtf')
      return { text: tidy(bounded(rtfText(source))), usedOcr: false }
    if (source.includes('\u0000') || source.slice(0, 8000).includes('\ufffd'))
      throw new Error(
        '이 파일은 텍스트로 읽을 수 없습니다. 지원 문서 형식으로 변환해 주세요. 음성·영상·실행 파일은 지원하지 않습니다.',
      )
    result = {
      text: /^(xml|svg)$/.test(extension)
        ? xmlText(source)
        : /^(html|htm)$/.test(extension)
          ? await htmlText(source)
          : source,
      usedOcr: false,
    }
  }
  check(options.signal)
  result.text = tidy(bounded(result.text))
  // Page labels do not count as extracted text.
  if (!result.text.replace(/\[\d+페이지\]/g, '').trim())
    throw new Error(
      options.pdfOcr
        ? '읽을 수 있는 글자를 찾지 못했습니다. 파일의 상태와 이미지 선명도를 확인해 주세요.'
        : '읽을 수 있는 글자가 없습니다. 스캔 PDF라면 PDF 이미지 글자 인식을 켜 주세요.',
    )
  return result
}
async function htmlText(source: string) {
  // A pure parser does not create DOM resource elements or fetch remote URLs.
  const { parse } = await import('parse5')
  const doc = parse(source)
  type HtmlNode = { nodeName: string; value?: string; childNodes?: HtmlNode[] }
  function walk(node: HtmlNode): string {
    if (
      ['script', 'style', 'iframe', 'object', 'noscript', 'head'].includes(
        node.nodeName,
      )
    )
      return ''
    if (node.nodeName === '#text') return node.value ?? ''
    return (
      (node.childNodes ?? []).map(walk).join('') +
      (['p', 'div', 'li', 'tr', 'br', 'h1', 'h2', 'h3'].includes(node.nodeName)
        ? '\n'
        : '')
    )
  }
  return walk(doc)
}
export function rtfText(source: string): string {
  if (!source.startsWith('{\\rtf'))
    throw new Error('올바른 RTF 문서가 아닙니다.')
  const stack: { skip: boolean; uc: number }[] = []
  let state = { skip: false, uc: 1 },
    text = '',
    fallback = 0
  const encoding = /\\ansicpg(949|1361)/.test(source)
    ? 'euc-kr'
    : 'windows-1252'
  for (let i = 0; i < source.length;) {
    const char = source[i++]
    if (char === '{') {
      stack.push({ ...state })
      continue
    }
    if (char === '}') {
      state = stack.pop() ?? { skip: false, uc: 1 }
      continue
    }
    if (char !== '\\') {
      if (fallback > 0 && char !== '\n' && char !== '\r') fallback--
      else if (!state.skip && char !== '\n' && char !== '\r') text += char
      continue
    }
    if (source[i] === '*') {
      state.skip = true
      i++
      continue
    }
    if (source[i] === "'") {
      const values: number[] = []
      do {
        values.push(parseInt(source.slice(i + 1, i + 3), 16))
        i += 3
        if (source[i] !== '\\' || source[i + 1] !== "'") break
        i++
      } while (i < source.length)
      if (fallback > 0) fallback = Math.max(0, fallback - values.length)
      else if (!state.skip)
        text += new TextDecoder(encoding).decode(new Uint8Array(values))
      continue
    }
    if (['{', '}', '\\', '~', '_', '-'].includes(source[i])) {
      if (fallback > 0) fallback--
      else if (!state.skip)
        text +=
          ({ '~': ' ', _: '-', '-': '' } as Record<string, string>)[
            source[i]
          ] ?? source[i]
      i++
      continue
    }
    const match = /^([a-z]+)(-?\d+)? ?/i.exec(source.slice(i))
    if (!match) {
      i++
      continue
    }
    i += match[0].length
    const word = match[1],
      value = Number(match[2])
    if (
      [
        'fonttbl',
        'colortbl',
        'stylesheet',
        'info',
        'pict',
        'object',
        'filetbl',
        'datastore',
        'themedata',
        'fldinst',
      ].includes(word)
    )
      state.skip = true
    if (word === 'bin') {
      i += Math.max(0, value)
      continue
    }
    if (state.skip) continue
    if (word === 'uc') state.uc = value
    else if (word === 'u') {
      text += String.fromCharCode(value & 0xffff)
      fallback = state.uc
    } else if (['par', 'line', 'row'].includes(word)) text += '\n'
    else if (['tab', 'cell'].includes(word)) text += '\t'
    else if (word === 'emdash') text += '—'
    else if (word === 'endash') text += '–'
    bounded(text)
  }
  if (!text.trim())
    throw new Error('RTF에서 읽을 수 있는 글자를 찾지 못했습니다.')
  return text
}
