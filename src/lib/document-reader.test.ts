import { describe, expect, it } from 'vitest'
import { zipSync, strToU8, deflateSync } from 'fflate'
import * as CFB from 'cfb'
import * as XLSX from 'xlsx'
import {
  decodeText,
  hwpRecords,
  MAX_FILE_BYTES,
  readDocument,
  rtfText,
} from './document-reader'

function file(name: string, value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? strToU8(value) : value
  const result = new File([bytes as BlobPart], name)
  Object.defineProperty(result, 'arrayBuffer', {
    value: async () => Uint8Array.from(bytes).buffer,
  })
  return result
}
const options = () => ({
  signal: new AbortController().signal,
  onProgress: () => {},
  pdfOcr: true,
})
const zip = (entries: Record<string, string>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, value]) => [name, strToU8(value)]),
    ),
  )
const utf16 = (text: string) => {
  const bytes = new Uint8Array(text.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < text.length; i++)
    view.setUint16(i * 2, text.charCodeAt(i), true)
  return bytes
}

it('reads arbitrary text extensions, BOM encodings and Korean legacy encodings', async () => {
  expect(
    (
      await readDocument(
        file('contacts.custom', '이름: 김서연\n010-1234-5678'),
        options(),
      )
    ).text,
  ).toContain('김서연')
  expect(
    decodeText(new Uint8Array([0xff, 0xfe, ...utf16('이름: 김서연')])),
  ).toBe('이름: 김서연')
  expect(decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]))).toBe('한글')
})

describe('structured documents', () => {
  it.each([
    [
      'docx',
      'word/document.xml',
      '<w:document xmlns:w="urn:word"><w:p><w:r><w:t>이름: </w:t></w:r><w:r><w:t>김서연</w:t></w:r></w:p><w:p><w:r><w:t>contact@example.com</w:t></w:r></w:p></w:document>',
    ],
    [
      'pptx',
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>이름: 김서연</a:t></a:r></a:p><a:p><a:r><a:t>contact@example.com</a:t></a:r></a:p></p:sld>',
    ],
    [
      'hwpx',
      'Contents/section0.xml',
      '<hp:sec xmlns:hp="urn:hp"><hp:p><hp:run><hp:t>이름: 김서연</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>contact@example.com</hp:t></hp:run></hp:p></hp:sec>',
    ],
    [
      'odt',
      'content.xml',
      '<office:document xmlns:office="urn:o" xmlns:text="urn:t"><text:p>이름: 김서연</text:p><text:p>contact@example.com</text:p></office:document>',
    ],
  ])(
    'extracts %s runs with paragraph boundaries',
    async (extension, path, xml) => {
      const result = await readDocument(
        file(`test.${extension}`, zip({ [path]: xml })),
        options(),
      )
      expect(result.text).toBe('이름: 김서연\ncontact@example.com')
      expect(result.usedOcr).toBe(false)
    },
  )
  it('reads EPUB in spine order rather than filename order', async () => {
    const bytes = zip({
      'META-INF/container.xml':
        '<container><rootfiles><rootfile full-path="book/content.opf"/></rootfiles></container>',
      'book/content.opf':
        '<package><manifest><item id="first" href="z.xhtml"/><item id="second" href="a.xhtml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>',
      'book/z.xhtml': '<html><body><p>First</p></body></html>',
      'book/a.xhtml': '<html><body><p>Second</p></body></html>',
    })
    expect((await readDocument(file('test.epub', bytes), options())).text).toBe(
      'First\n\nSecond',
    )
  })
  it.each(['xlsx', 'xls', 'ods'] as const)(
    'reads %s workbook cells and all sheets',
    async (extension) => {
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['이름', '이메일'],
          ['김서연', 'contact@example.com'],
        ]),
        '고객',
      )
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([['010-1234-5678']]),
        '전화',
      )
      const data = XLSX.write(workbook, { type: 'array', bookType: extension })
      const result = await readDocument(
        file(`test.${extension}`, new Uint8Array(data)),
        options(),
      )
      expect(result.text).toContain('김서연\tcontact@example.com')
      expect(result.text).toContain('[전화]\n010-1234-5678')
    },
  )
  it('extracts HWP paragraph records and rejects protected HWP', async () => {
    const textBytes = utf16('이름: 김서연\rcontact@example.com')
    const record = new Uint8Array(4 + textBytes.length)
    new DataView(record.buffer).setUint32(
      0,
      67 | (textBytes.length << 20),
      true,
    )
    record.set(textBytes, 4)
    expect(hwpRecords(record)).toContain('김서연\ncontact@example.com')
    const cfb = CFB.utils.cfb_new()
    const header = new Uint8Array(40)
    CFB.utils.cfb_add(cfb, 'FileHeader', header)
    CFB.utils.cfb_add(cfb, 'BodyText/Section0', record)
    const result = await readDocument(
      file('test.hwp', CFB.write(cfb, { type: 'array' })),
      options(),
    )
    expect(result.text).toContain('김서연')
    header[36] = 1
    CFB.utils.cfb_add(cfb, 'FileHeader', header)
    CFB.utils.cfb_add(cfb, 'Section0', deflateSync(record))
    expect(
      (
        await readDocument(
          file('compressed.hwp', CFB.write(cfb, { type: 'array' })),
          options(),
        )
      ).text,
    ).toContain('김서연')
    header[36] = 2
    CFB.utils.cfb_add(cfb, 'FileHeader', header)
    await expect(
      readDocument(
        file('locked.hwp', CFB.write(cfb, { type: 'array' })),
        options(),
      ),
    ).rejects.toThrow('암호화')
  })
  it('reads legacy Word piece tables with Unicode text', async () => {
    const word = new Uint8Array(1024),
      table = new Uint8Array(21),
      text = utf16('이름: 김서연')
    new DataView(word.buffer).setUint32(0x1a2, 0, true)
    word.set(text, 512)
    table[0] = 2
    const view = new DataView(table.buffer)
    view.setUint32(1, 16, true)
    view.setUint32(9, text.length / 2, true)
    view.setUint32(15, 512, true)
    const cfb = CFB.utils.cfb_new()
    CFB.utils.cfb_add(cfb, 'WordDocument', word)
    CFB.utils.cfb_add(cfb, '0Table', table)
    expect(
      (
        await readDocument(
          file('test.doc', CFB.write(cfb, { type: 'array' })),
          options(),
        )
      ).text,
    ).toBe('이름: 김서연')
  })
  it('reads legacy PowerPoint Unicode atoms', async () => {
    const text = utf16('이름: 김서연'),
      record = new Uint8Array(text.length + 8)
    const view = new DataView(record.buffer)
    view.setUint16(2, 4000, true)
    view.setUint32(4, text.length, true)
    record.set(text, 8)
    const cfb = CFB.utils.cfb_new()
    CFB.utils.cfb_add(cfb, 'PowerPoint Document', record)
    expect(
      (
        await readDocument(
          file('test.ppt', CFB.write(cfb, { type: 'array' })),
          options(),
        )
      ).text,
    ).toBe('이름: 김서연')
  })
})

it('extracts RTF Unicode and skips pictures, font tables and fallback characters', () => {
  const source = String.raw`{\rtf1\ansi{\fonttbl{\f0 Hidden;}}\uc1\u51060?\u47492?: \u44608?\u49436?\u50672?\par contact@example.com{\pict hidden}}`
  expect(rtfText(source)).toBe('이름: 김서연\ncontact@example.com')
})
it('reads HTML without executing or rendering uploaded markup', async () => {
  const result = await readDocument(
    file(
      'test.html',
      '<html><head><title>ignore</title></head><body><p>이름: 김서연</p><img src="https://invalid.example/private"><script>throw "private"</script><p>contact@example.com</p></body></html>',
    ),
    options(),
  )
  expect(result.text).toBe('이름: 김서연\ncontact@example.com')
})
it('rejects oversized, binary, empty, cancelled and overly long input without partial results', async () => {
  const large = file('large.txt', 'test')
  Object.defineProperty(large, 'size', { value: MAX_FILE_BYTES + 1 })
  await expect(readDocument(large, options())).rejects.toThrow('50MB')
  await expect(
    readDocument(
      file('program.exe', new Uint8Array([77, 90, 0, 0])),
      options(),
    ),
  ).rejects.toThrow('지원하지 않습니다')
  await expect(readDocument(file('empty.txt', ''), options())).rejects.toThrow(
    '빈 파일',
  )
  await expect(
    readDocument(file('long.txt', 'a'.repeat(1_000_001)), options()),
  ).rejects.toThrow('100만 자')
  const controller = new AbortController()
  controller.abort()
  await expect(
    readDocument(file('test.txt', 'private'), {
      ...options(),
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
})
