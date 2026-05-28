import io


def _extract_pdf_text(file_content: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(file_content))
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n".join(pages)


def _extract_docx_text(file_content: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(file_content))
    paragraphs = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    return "\n".join(paragraphs)


def extract_resume_text(filename: str, file_content: bytes) -> str:
    ext = (filename or "").lower().rsplit(".", 1)
    ext = f".{ext[-1]}" if len(ext) > 1 else ""

    if ext == ".pdf":
        text = _extract_pdf_text(file_content)
    elif ext == ".docx":
        text = _extract_docx_text(file_content)
    else:
        # Fallback path for txt/doc and unknown formats.
        text = file_content.decode("utf-8", errors="ignore")

    cleaned = text.replace("\x00", " ")
    cleaned = "\n".join(line.strip() for line in cleaned.splitlines() if line.strip())
    return cleaned