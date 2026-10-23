import { useEffect, useRef, useState } from 'react'
import { EXTRACTION_NOTE, readDocument } from '@/lib/document-reader'
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Copy,
  FileText,
  Fingerprint,
  Info,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'



type Finding = {
  start: number
  end: number
  value: string
  type: string
  enabled: boolean
}
const rules = [
  { type: '주민등록번호', pattern: /\b\d{6}\s*-?\s*[1-8]\d{6}\b/g },
  {
    type: '이메일',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    type: '전화번호',
    pattern:
      /(?:\+82[- .]?)?0?1[016789][- .]?\d{3,4}[- .]?\d{4}\b|0\d{1,2}-\d{3,4}-\d{4}\b/g,
  },
  { type: '카드번호', pattern: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g },
  {
    type: '이름',
    pattern:
      /(?<=(?:이름|성명)[:：][ \t]*)(?:[가-힣](?:[ \t]+[가-힣](?![가-힣])){1,3}|[가-힣]{2,4})/g,
  },
  {
    type: '주소',
    pattern:
      /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|전라|경상|제주)[가-힣]*(?:시|도)?\s[가-힣0-9\s]+(?:로|길)\s?\d+(?:-\d+)?(?:\s\d+동\s?\d+호)?/g,
  },
]
const sample =
  '안녕하세요. 아래 고객 정보를 바탕으로 안내 메일을 작성해 주세요.\n\n이름: 김서연\n이메일: seoyeon.kim@example.com\n전화번호: 010-2847-6391\n주소: 서울시 마포구 월드컵북로 21\n\n다음 주 상담 일정을 정중한 말투로 안내해 주세요.'
function detect(text: string): Finding[] {
  const results: Finding[] = []
  for (const rule of rules) {
    for (const m of text.matchAll(new RegExp(rule.pattern.source, 'g'))) {
      const start = m.index ?? 0
      if (!results.some((r) => start < r.end && start + m[0].length > r.start))
        results.push({
          start,
          end: start + m[0].length,
          value: m[0],
          type: rule.type,
          enabled: true,
        })
    }
  }
  return results.sort((a, b) => a.start - b.start)
}
export default function Home() {
  const [tab, setTab] = useState<'text' | 'file'>('text')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [findings, setFindings] = useState<Finding[]>([])
  const [scanned, setScanned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dialog, setDialog] = useState<'help' | 'privacy' | null>(null)
  const [reading, setReading] = useState(false)
  const [readStatus, setReadStatus] = useState('')
  const [readError, setReadError] = useState('')
  const [fileNotice, setFileNotice] = useState('')
  const [pdfOcr, setPdfOcr] = useState(true)
  const readController = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => () => readController.current?.abort(), [])
  const revision = useRef(0)
  const result = findings.reduceRight(
    (s, f) =>
      f.enabled
        ? s.slice(0, f.start) + '[' + f.type + ' 가림]' + s.slice(f.end)
        : s,
    text,
  )
  const protectedCount = findings.filter((f) => f.enabled).length
  function update(value: string) {
    readController.current?.abort()
    setReading(false)
    setReadStatus('')
    setReadError('')
    setFileNotice('')
    revision.current += 1
    setBusy(false)
    setText(value)
    setScanned(false)
    setFindings([])
    setMessage('')
  }
  function scan() {
    if (!text.trim()) {
      setMessage('검사할 내용을 먼저 입력해 주세요.')
      return
    }
    setBusy(true)
    setMessage('')
    const currentRevision = revision.current
    window.setTimeout(() => {
      if (revision.current !== currentRevision) return
      setFindings(detect(text))
      setScanned(true)
      setBusy(false)
    }, 550)
  }
  function cancelRead() {
    readController.current?.abort()
    setReading(false)
    setReadStatus('')
    setReadError('파일 읽기를 취소했습니다. 이전 입력은 그대로 유지됩니다.')
  }
  async function readFile(file?: File) {
    if (!file) return
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    revision.current += 1
    setBusy(false)
    setReading(true)
    setReadError('')
    setReadStatus('파일 준비 중…')
    setMessage('')
    try {
      const extracted = await readDocument(file, {
        signal: controller.signal,
        pdfOcr,
        onProgress: (status) => {
          if (!controller.signal.aborted) setReadStatus(status)
        },
      })
      if (controller.signal.aborted) return
      update(extracted.text)
      setFileName(file.name)
      setFileNotice(
        extracted.usedOcr
          ? '글자 인식 완료 · 오인식이나 누락이 있을 수 있어요. 원본과 비교한 뒤 검사해 주세요.'
          : '텍스트 추출 완료 · 내용을 확인한 뒤 개인정보 검사를 실행하세요.',
      )
    } catch (error) {
      if (!controller.signal.aborted) {
        const detail = error instanceof Error ? error.message : ''
        setReadError(
          /[가-힣]/.test(detail)
            ? detail
            : '파일을 읽지 못했습니다. 암호·손상 여부를 확인하거나 PDF·TXT로 변환해 주세요.',
        )
      }
    } finally {
      if (readController.current === controller) {
        setReading(false)
        setReadStatus('')
      }
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(result)
      setMessage('보호된 내용을 복사했습니다.')
    } catch {
      setMessage('복사 권한을 확인하거나 파일로 내려받아 주세요.')
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([result], { type: 'text/plain;charset=utf-8' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'promptguard-protected.txt'
    a.click()
    URL.revokeObjectURL(url)
    setMessage('보호된 텍스트 파일을 내려받았습니다.')
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <ShieldCheck size={23} />
          </span>
          Prompt<span>Guard</span>
          <span className="brand-dot" />
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button
          className="nav-item active"
          onClick={() => {
            update('')
            setFileName('')
            setTab('text')
          }}
        >
          <ScanLine size={19} />
          개인정보 보호
          <span className="nav-dot" />
        </button>
        <div className="sidebar-guide">
          <span className="small-shield">
            <ShieldCheck size={20} />
          </span>
          <h3>안심하고, AI 하세요.</h3>
          <p>
            개인정보는 지키고
            <br />
            아이디어는 자유롭게.
          </p>
          <span className="local-tag">
            <span />내 기기에서 안전하게 처리
          </span>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setDialog('help')}>
            <CircleHelp size={18} />
            이용 가이드
            <ChevronRight size={15} />
          </button>
          <div className="sidebar-footer">
            <span className="avatar">P</span>
            <div>
              나의 워크스페이스<small>Personal workspace</small>
            </div>
            <LockKeyhole size={14} />
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div>
            워크스페이스
            <ChevronRight size={14} />
            <strong>개인정보 보호</strong>
          </div>
          <span className="private-badge">
            <span />
            프라이버시 우선 설계
          </span>
          <button
            className="help-button"
            aria-label="도움말"
            onClick={() => setDialog('help')}
          >
            <CircleHelp size={19} />
          </button>
        </header>
        <main>
          <section className="page-heading">
            <div className="eyebrow">
              <span />
              YOUR PRIVACY, PROTECTED
            </div>
            <h1>
              AI에 보내기 전,
              <br className="mobile-break" /> 한 번 더 안심하세요<span>.</span>
            </h1>
            <p>
              글과 파일 속 개인정보를 찾아 가려드려요. 이제 AI와 안전하게
              대화하세요.
            </p>
            <div className="heading-seal">
              <ShieldCheck size={32} />
              <span>
                나의 정보는
                <br />
                <strong>내가 지키니까.</strong>
              </span>
            </div>
          </section>
          <div className="steps">
            <span className="step-current">
              <b>1</b>내용 입력
            </span>
            <div />
            <span className={scanned ? 'step-current' : ''}>
              <b>2</b>개인정보 확인
            </span>
            <div />
            <span>
              <b>3</b>안전하게 사용
            </span>
          </div>
          <section className="editor-grid">
            <div className="editor-card input-card">
              <div className="card-heading">
                <div>
                  <span className="number">01</span>
                  <h2>보호할 내용</h2>
                </div>
                <span className="sub-label">INPUT</span>
              </div>
              <div className="tabs">
                <button
                  className={tab === 'text' ? 'selected' : ''}
                  onClick={() => setTab('text')}
                >
                  <FileText size={16} />
                  텍스트 입력
                </button>
                <button
                  className={tab === 'file' ? 'selected' : ''}
                  onClick={() => setTab('file')}
                >
                  <Upload size={16} />
                  파일 업로드
                </button>
              </div>
              {tab === 'file' && (
                <div className="file-panel">
                  <div
                    className="dropzone"
                    aria-busy={reading}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (e.dataTransfer.files.length > 1) {
                        setReadError('한 번에 한 파일씩 선택해 주세요.')
                        return
                      }
                      void readFile(e.dataTransfer.files[0])
                    }}
                  >
                    <Upload size={23} />
                    <button onClick={() => inputRef.current?.click()}>
                      {fileName || '파일을 선택하거나 여기에 놓아주세요'}
                    </button>
                    <small>
                      문서·이미지 파일 · 파일당 최대 50MB · PDF/TIFF 최대
                      100페이지
                    </small>
                    <small>
                      PDF · HWP/HWPX · Word · Excel · PowerPoint · ODF · EPUB ·
                      RTF · 텍스트
                    </small>
                    <small>
                      PNG · JPG · WEBP · BMP · GIF(첫 프레임) · TIFF ·
                      한국어/영어 OCR
                    </small>
                  </div>
                  <label className="ocr-option">
                    <input
                      type="checkbox"
                      checked={pdfOcr}
                      onChange={(e) => setPdfOcr(e.target.checked)}
                      disabled={reading}
                    />
                    PDF의 이미지·스캔 글자도 인식하기{' '}
                    <span>시간이 더 걸려요</span>
                  </label>
                  <p className="file-limits">
                    텍스트 최대 100만 자 · 압축 해제 최대 100MB · 이미지 최대
                    5천만 화소. 암호화 문서, 음성·영상·실행 파일은 지원하지
                    않아요. 구형 문서는 변환이 필요할 수 있어요.
                  </p>
                  <p className="file-limits">{EXTRACTION_NOTE}</p>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  void readFile(file)
                }}
              />
              {reading && (
                <div className="file-progress" role="status">
                  <ScanLine className="spinning" size={16} />
                  <span>{readStatus}</span>
                  <button onClick={cancelRead}>취소</button>
                </div>
              )}
              {readError && (
                <p className="file-error" role="alert">
                  <Info size={15} />
                  {readError}
                </p>
              )}
              {fileNotice && (
                <p className="file-notice" role="status">
                  <Check size={15} />
                  {fileNotice}
                </p>
              )}
              <div className="text-area-wrap">
                <textarea
                  value={text}
                  onChange={(e) => update(e.target.value)}
                  placeholder={
                    'AI에게 보낼 내용을 여기에 붙여넣으세요.\n\n이메일, 전화번호, 주민등록번호 등\n노출되면 안 되는 개인정보를 확인해 드릴게요.'
                  }
                  aria-label="개인정보를 검사할 텍스트"
                  spellCheck={false}
                />
                <div className="textarea-footer">
                  <button
                    onClick={() => {
                      update(sample)
                      setFileName('')
                    }}
                  >
                    <Sparkles size={14} />
                    예시로 체험하기
                  </button>
                  <span>{text.length.toLocaleString()}자</span>
                </div>
              </div>
              <div className="input-bottom">
                <div>
                  <LockKeyhole size={14} />
                  <span>입력한 내용은 서버에 저장되지 않아요</span>
                </div>
                <button
                  className="primary-button"
                  disabled={busy || reading || !text.trim()}
                  onClick={scan}
                >
                  {busy ? (
                    <>
                      <ScanLine className="spinning" size={17} />
                      검사 중...
                    </>
                  ) : (
                    <>
                      <ScanLine size={17} />
                      개인정보 검사하기
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </div>
            </div>
            <div
              className={
                'editor-card result-card ' + (scanned ? 'has-result' : '')
              }
            >
              <div className="card-heading">
                <div>
                  <span className="number">02</span>
                  <h2>보호된 결과</h2>
                </div>
                <span className="result-label">
                  <span />
                  {scanned ? '검사 완료' : '검사 대기 중'}
                </span>
              </div>
              {busy ? (
                <div className="empty-result">
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                  <p>개인정보 패턴을 확인하고 있어요.</p>
                </div>
              ) : scanned ? (
                <div className="result-content">
                  <div className="result-summary">
                    <ShieldCheck size={18} />
                    <strong>
                      {findings.length}개의 개인정보 후보를 찾았어요
                    </strong>
                    <span>{protectedCount}개 보호</span>
                  </div>
                  {findings.length > 0 && (
                    <div className="finding-list">
                      {findings.map((f, i) => (
                        <label key={f.start}>
                          <input
                            type="checkbox"
                            checked={f.enabled}
                            onChange={() =>
                              setFindings((prev) =>
                                prev.map((x, j) =>
                                  i === j ? { ...x, enabled: !x.enabled } : x,
                                ),
                              )
                            }
                          />
                          <span>{f.type}</span>
                          <span className="masked-value">
                            {'•'.repeat(Math.min(f.value.length, 12))}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  <pre className="result-text">{result}</pre>
                  <p className="review-note">
                    자동 탐지는 모든 개인정보를 찾지 못할 수 있어요. 사용 전
                    내용을 직접 확인해 주세요.
                  </p>
                </div>
              ) : (
                <div className="empty-result">
                  <div className="document-art">
                    <div className="art-top">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="art-line" />
                    <div className="art-line partial" />
                    <div className="art-redaction">
                      <span />
                      <LockKeyhole size={12} />
                    </div>
                    <div className="art-line" />
                    <div className="art-redaction narrow">
                      <span />
                      <Check size={12} />
                    </div>
                    <span className="art-shield">
                      <ShieldCheck size={28} />
                    </span>
                  </div>
                  <h3>안전한 프롬프트의 시작</h3>
                  <p>
                    왼쪽에 내용을 입력하고 검사해 보세요.
                    <br />
                    개인정보를 가린 결과가 여기에 표시돼요.
                  </p>
                  <span className="empty-pill">
                    <ShieldCheck size={13} />
                    개인정보는 가리고, 맥락은 그대로
                  </span>
                </div>
              )}
              <div className="result-bottom">
                <span>
                  <CheckCheck size={15} />
                  {scanned
                    ? '내용을 확인한 후 사용하세요'
                    : '검사 후 복사하거나 다운로드하세요'}
                </span>
                <button
                  disabled={!scanned || busy || reading}
                  onClick={download}
                  aria-label="결과 다운로드"
                >
                  <ArrowDownToLine size={17} />
                </button>
                <button disabled={!scanned || busy || reading} onClick={copy}>
                  <Copy size={15} />
                  복사하기
                </button>
              </div>
            </div>
          </section>
          <div className="detection-strip">
            <div>
              <Fingerprint size={19} />
              <strong>이런 정보를 찾아요</strong>
            </div>
            <div className="detection-tags">
              {[
                '이름',
                '이메일',
                '전화번호',
                '주민등록번호',
                '카드번호',
                '주소',
              ].map((t) => (
                <span key={t}>
                  <Check size={12} />
                  {t}
                </span>
              ))}
            </div>
            <span className="pattern-note">
              패턴 기반 탐지
              <Info size={13} />
            </span>
          </div>
          <section className="privacy-banner">
            <div className="banner-icon">
              <LockKeyhole size={24} />
            </div>
            <div>
              <h3>당신의 정보는, 당신의 브라우저 안에.</h3>
              <p>
                검사는 이 기기에서만 이루어져요. 입력한 원문과 파일을 외부
                서버나 AI에 전송하지 않아요.
              </p>
            </div>
            <button onClick={() => setDialog('privacy')}>
              개인정보 보호 안내
              <ArrowRight size={15} />
            </button>
          </section>
          <footer className="page-footer">
            <span>© {new Date().getFullYear()} PromptGuard</span>
            <span>
              AI를 더 안전하게 사용하는 작은 습관.
              <span className="footer-dot" />
              Made for your privacy
            </span>
          </footer>
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          <Info size={17} />
          {message}
          <button aria-label="알림 닫기" onClick={() => setMessage('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="닫기"
              onClick={() => setDialog(null)}
            >
              <X size={20} />
            </button>
            <ShieldCheck size={32} />
            <h2 id="modal-title">
              {dialog === 'help'
                ? '안전한 AI 사용, 세 단계면 충분해요'
                : '내 정보가 머무는 곳'}
            </h2>
            {dialog === 'help' ? (
              <>
                <p>
                  1. 글을 붙여넣거나 문서·이미지 파일을 선택하세요. PDF,
                  HWP/HWPX, DOC/DOCX, XLS/XLSX/XLSM/XLSB, PPT/PPTX, ODT/ODS/ODP,
                  EPUB, RTF와 텍스트 파일을 읽습니다. 파일당 최대 50MB, PDF/TIFF
                  최대 100페이지, 추출 텍스트 최대 100만 자입니다.
                </p>
                <p>
                  2. 추출한 글자를 확인하고 개인정보 검사를 실행하세요.
                  PNG/JPG/WEBP/BMP/GIF(첫 프레임)/TIFF와 PDF의 이미지는
                  한국어·영어 글자 인식을 지원합니다. 스캔 PDF는 PDF 이미지 글자
                  인식을 켜 주세요. 탐지된 항목의 가림 여부를 선택하세요.
                </p>
                <p>
                  3. 보호된 결과를 직접 검토한 뒤 복사하거나 TXT로 내려받으세요.
                  원본 문서 자체가 수정되는 것은 아닙니다. OCR 오인식·누락과
                  문서 내부 이미지·메타데이터는 직접 확인해 주세요. 암호화
                  문서·음성·영상·실행 파일은 지원하지 않습니다.
                </p>
                <p>
                  이름은 ‘이름:’ 또는 ‘성명:’ 뒤의 한국어 이름을 탐지합니다.
                  주소와 번호는 정해진 패턴으로 검사하므로 누락이나 오탐이 있을
                  수 있습니다.
                </p>
              </>
            ) : (
              <>
                <p>
                  텍스트와 파일은 현재 브라우저 메모리에서만 처리합니다. 원문을
                  서버에 업로드하거나 AI 모델로 보내지 않으며, 검사 내역을
                  저장하지 않습니다.
                </p>
                <p>
                  페이지를 새로고침하면 입력한 내용이 사라집니다. 복사하거나
                  내려받은 결과는 직접 관리해 주세요.
                </p>
                <p>
                  자동 탐지는 완전한 익명화를 보장하지 않습니다. 문맥에 포함된
                  민감한 정보까지 확인한 후 AI에 전달하세요.
                </p>
              </>
            )}
            <button className="primary-button" onClick={() => setDialog(null)}>
              확인했어요
              <Check size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
