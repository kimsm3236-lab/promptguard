import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const output = new URL('../public/vendor/', import.meta.url)
await mkdir(output, { recursive: true })
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`))
const pdf = packageDir('pdfjs-dist')
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(resolve(pdf, directory), new URL(`pdf/${directory}`, output), {
    recursive: true,
  })
}
await cp(
  resolve(pdf, 'build/pdf.worker.min.mjs'),
  new URL('pdf/pdf.worker.min.mjs', output),
)
await cp(
  resolve(packageDir('tesseract.js'), 'dist/worker.min.js'),
  new URL('ocr/worker.min.js', output),
  { recursive: true },
)
const tesseractRequire = createRequire(require.resolve('tesseract.js'))
await cp(
  dirname(tesseractRequire.resolve('tesseract.js-core/package.json')),
  new URL('ocr/core', output),
  { recursive: true },
)
for (const language of ['kor', 'eng']) {
  await cp(
    resolve(
      packageDir(`@tesseract.js-data/${language}`),
      `4.0.0/${language}.traineddata.gz`,
    ),
    new URL(`ocr/${language}.traineddata.gz`, output),
  )
}
