#!/usr/bin/env python3
"""
Genera los casos de demo FICTICIOS (imágenes, PDF y correos .eml) en demo/fixtures/.
Todos los nombres, teléfonos, referencias y documentos son inventados.
Requisitos: pip install pillow reportlab

    python3 scripts/generate_fixtures.py
"""
import io
import math
import random
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "demo" / "fixtures"
ASSETS = OUT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)
random.seed(7)

W, H = 1600, 1200


def font(size, bold=False):
    for name in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


# --------------------------------------------------------------------------- fotos
def room_base(wall, floor, ceiling=(222, 214, 198)):
    """Habitación en perspectiva de un punto de fuga."""
    img = Image.new("RGB", (W, H), wall)
    d = ImageDraw.Draw(img)
    bx0, by0, bx1, by1 = 470, 300, 1130, 800  # pared del fondo
    d.polygon([(0, 0), (W, 0), (bx1, by0), (bx0, by0)], fill=ceiling)
    d.polygon([(0, H), (W, H), (bx1, by1), (bx0, by1)], fill=floor)
    left = tuple(max(0, c - 22) for c in wall)
    right = tuple(max(0, c - 12) for c in wall)
    d.polygon([(0, 0), (bx0, by0), (bx0, by1), (0, H)], fill=left)
    d.polygon([(W, 0), (bx1, by0), (bx1, by1), (W, H)], fill=right)
    d.rectangle([bx0, by0, bx1, by1], fill=wall)
    for p in [((0, 0), (bx0, by0)), ((W, 0), (bx1, by0)), ((0, H), (bx0, by1)), ((W, H), (bx1, by1))]:
        d.line(p, fill=tuple(max(0, c - 40) for c in wall), width=2)
    return img, d, (bx0, by0, bx1, by1)


def floor_tiles(d, box, c1, c2, n=9, hydraulic=False):
    bx0, by0, bx1, by1 = box
    rows = 7
    for r in range(rows):
        t0 = (r / rows) ** 1.6
        t1 = ((r + 1) / rows) ** 1.6
        y0 = by1 + (H - by1) * t0
        y1 = by1 + (H - by1) * t1
        for c in range(n):
            def x_at(t, k):
                xl = bx0 + (0 - bx0) * t
                xr = bx1 + (W - bx1) * t
                return xl + (xr - xl) * k / n
            pts = [(x_at(t0, c), y0), (x_at(t0, c + 1), y0), (x_at(t1, c + 1), y1), (x_at(t1, c), y1)]
            col = c1 if (r + c) % 2 == 0 else c2
            col = tuple(max(0, min(255, v + random.randint(-8, 8))) for v in col)
            d.polygon(pts, fill=col, outline=(90, 80, 70))
            if hydraulic:
                cx = sum(p[0] for p in pts) / 4
                cy = sum(p[1] for p in pts) / 4
                rr = (y1 - y0) * 0.28
                d.ellipse([cx - rr * 1.6, cy - rr, cx + rr * 1.6, cy + rr], outline=(120, 60, 50), width=2)


def parquet(d, box):
    bx0, by0, bx1, by1 = box
    for i in range(26):
        k = i / 26
        x_far = bx0 + (bx1 - bx0) * k
        x_near = 0 + W * k
        d.line([(x_far, by1), (x_near, H)], fill=(110, 72, 40), width=2)
    for r in range(10):
        t = (r / 10) ** 1.5
        y = by1 + (H - by1) * t
        d.line([(bx0 * (1 - t), y), (bx1 + (W - bx1) * t, y)], fill=(125, 85, 50), width=1)


def wall_tiles(d, box, color, size=46, height=520):
    bx0, by0, bx1, by1 = box
    top = by1 - height * (by1 - by0) / 500
    d.rectangle([bx0, top, bx1, by1], fill=color)
    y = top
    while y < by1:
        d.line([(bx0, y), (bx1, y)], fill=(170, 170, 160), width=1)
        y += size * 0.62
    x = bx0
    while x < bx1:
        d.line([(x, top), (x, by1)], fill=(170, 170, 160), width=1)
        x += size * 0.62


def stain(img, cx, cy, rx, ry, color=(120, 105, 70), alpha=110):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for i in range(6):
        k = 1 - i * 0.12
        ld.ellipse([cx - rx * k + random.randint(-15, 15), cy - ry * k, cx + rx * k, cy + ry * k + random.randint(-10, 10)], fill=color + (int(alpha * (0.35 + i * 0.12)),))
    layer = layer.filter(ImageFilter.GaussianBlur(18))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"))


def crack(d, x, y, length=260):
    pts = [(x, y)]
    for _ in range(14):
        x += random.randint(-14, 14)
        y += length / 14
        pts.append((x, y))
    d.line(pts, fill=(70, 62, 55), width=3)


def window(d, x0, y0, x1, y1, frame=(150, 110, 70)):
    d.rectangle([x0, y0, x1, y1], fill=(196, 214, 228), outline=frame, width=14)
    d.line([((x0 + x1) / 2, y0), ((x0 + x1) / 2, y1)], fill=frame, width=10)
    d.line([(x0, (y0 + y1) / 2), (x1, (y0 + y1) / 2)], fill=frame, width=8)


def radiator(d, x, y, n=10):
    for i in range(n):
        d.rounded_rectangle([x + i * 22, y, x + i * 22 + 18, y + 120], radius=6, fill=(205, 200, 190), outline=(150, 145, 135))


def finish(img, name):
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    noise = Image.effect_noise(img.size, 18).convert("L")
    img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.06)
    # viñeta
    vig = Image.new("L", img.size, 0)
    vd = ImageDraw.Draw(vig)
    for i in range(40):
        vd.ellipse([-200 + i * 6, -200 + i * 6, W + 200 - i * 6, H + 200 - i * 6], fill=int(i * 6))
    vig = vig.filter(ImageFilter.GaussianBlur(60))
    dark = Image.new("RGB", img.size, (20, 18, 15))
    img = Image.blend(img, Image.composite(img, dark, vig), 0.45)
    img.save(ASSETS / name, "JPEG", quality=78)
    return ASSETS / name


def foto_cocina():
    img, d, box = room_base((236, 232, 220), (180, 160, 140))
    floor_tiles(d, box, (196, 176, 150), (120, 60, 50), hydraulic=True)
    wall_tiles(d, box, (232, 230, 205), height=330)
    bx0, by0, bx1, by1 = box
    d.rectangle([bx0 + 20, by1 - 190, bx1 - 20, by1], fill=(120, 82, 50), outline=(60, 40, 25), width=3)  # muebles bajos
    for i in range(6):
        d.rectangle([bx0 + 30 + i * 102, by1 - 180, bx0 + 120 + i * 102, by1 - 10], outline=(70, 45, 28), width=3)
    d.rectangle([bx0 + 40, by0 + 40, bx0 + 340, by0 + 170], fill=(128, 90, 56), outline=(60, 40, 25), width=3)  # altos
    window(d, bx1 - 260, by0 + 30, bx1 - 40, by0 + 230)
    d.rectangle([bx0 + 380, by0 + 20, bx0 + 470, by0 + 130], fill=(170, 170, 165))  # calentador
    stain(img, bx0 + 420, by0 - 60, 160, 60, (110, 100, 70))
    return finish(img, "IMG_20261114_cocina.jpg")


def foto_bano():
    img, d, box = room_base((206, 222, 230), (210, 205, 195))
    floor_tiles(d, box, (225, 222, 215), (190, 186, 180), n=12)
    wall_tiles(d, box, (170, 205, 222), height=420)
    bx0, by0, bx1, by1 = box
    d.rounded_rectangle([bx0 + 10, by1 - 150, bx0 + 420, by1], radius=30, fill=(245, 245, 240), outline=(150, 150, 150), width=3)  # bañera
    d.rectangle([bx1 - 70, by0 - 10, bx1 - 30, by1 + 40], fill=(150, 152, 148), outline=(110, 110, 105))  # bajante
    for y in range(by0, by1, 90):
        d.rectangle([bx1 - 76, y, bx1 - 24, y + 12], fill=(120, 122, 118))
    d.ellipse([bx1 - 260, by1 - 120, bx1 - 140, by1 - 10], fill=(248, 248, 244), outline=(150, 150, 150), width=3)  # inodoro
    stain(img, W // 2, 120, 260, 90, (95, 90, 60), 140)
    stain(img, bx0 + 200, by0 + 120, 120, 60, (60, 70, 50), 90)
    return finish(img, "IMG_20261114_bano.jpg")


def foto_salon():
    img, d, box = room_base((228, 220, 200), (150, 100, 60))
    parquet(d, box)
    bx0, by0, bx1, by1 = box
    window(d, bx0 + 160, by0 + 60, bx0 + 500, by0 + 400)
    radiator(d, bx0 + 200, by1 - 160, 12)
    crack(d, bx1 + 120, 180, 380)
    stain(img, 140, H - 330, 160, 110, (120, 100, 70))
    d.line([(bx0, by0 + 40), (0, 60)], fill=(240, 240, 240), width=5)  # cable visto
    return finish(img, "IMG_20261114_salon.jpg")


def foto_dormitorio():
    img, d, box = room_base((214, 196, 176), (178, 172, 160))
    floor_tiles(d, box, (176, 170, 158), (160, 152, 140), n=10)
    bx0, by0, bx1, by1 = box
    for x in range(bx0, bx1, 40):  # papel pintado
        for y in range(by0, by1, 50):
            d.ellipse([x + 12, y + 18, x + 26, y + 32], outline=(185, 160, 140))
    window(d, bx0 + 230, by0 + 80, bx0 + 450, by0 + 360, frame=(235, 235, 230))
    stain(img, bx1 + 150, H - 360, 140, 120, (110, 95, 65), 150)
    d.polygon([(bx1 + 80, H - 300), (bx1 + 250, H - 340), (bx1 + 240, H - 250)], fill=(190, 175, 155))  # desconchado
    return finish(img, "IMG_20261114_dormitorio.jpg")


def foto_pasillo():
    img, d, box = room_base((226, 218, 204), (165, 120, 80))
    parquet(d, (700, 350, 900, 750))
    bx0, by0, bx1, by1 = 700, 350, 900, 750
    d.rectangle([60, 300, 300, 1050], fill=(150, 110, 70), outline=(90, 60, 35), width=6)  # puertas
    d.rectangle([1320, 300, 1540, 1050], fill=(150, 110, 70), outline=(90, 60, 35), width=6)
    d.rectangle([420, 330, 600, 520], fill=(60, 60, 58), outline=(30, 30, 30), width=4)  # cuadro eléctrico antiguo
    for i in range(4):
        d.rectangle([440 + i * 40, 370, 465 + i * 40, 440], fill=(230, 225, 210))
    d.text((430, 470), "PLOMOS", fill=(230, 225, 210), font=font(22, True))
    for k in range(3):
        d.line([(510, 520), (520 + k * 30, 900)], fill=(240, 240, 240), width=4)
    return finish(img, "IMG_20261114_pasillo.jpg")


# ----------------------------------------------------------------- plano escaneado
def plano(incompleto=True, name="plano_escaneado_madre.pdf"):
    pw, ph = 2480, 1754  # A4 apaisado 300 ppp
    img = Image.new("RGB", (pw, ph), (250, 248, 240) if not incompleto else (236, 230, 214))
    d = ImageDraw.Draw(img)
    s = 26  # píxeles por decímetro aprox.
    ox, oy = 260, 260
    wall = 14

    def rect(x, y, w, h, label, area=None):
        d.rectangle([ox + x * s, oy + y * s, ox + (x + w) * s, oy + (y + h) * s], outline=(30, 30, 30), width=wall)
        d.text((ox + (x + w / 2) * s - 90, oy + (y + h / 2) * s - 20), label, fill=(30, 30, 30), font=font(38, True))
        if area:
            d.text((ox + (x + w / 2) * s - 60, oy + (y + h / 2) * s + 30), area, fill=(60, 60, 60), font=font(30))

    rect(0, 0, 30, 22, "SALÓN", "21,8 m²")
    rect(30, 0, 18, 22, "DORM. 1", "13,1 m²")
    rect(0, 22, 14, 18, "COCINA", "8,9 m²")
    rect(14, 22, 10, 10, "BAÑO", "3,9 m²")
    rect(14, 32, 34, 8, "PASILLO")
    rect(48, 0, 16, 22, "DORM. 2", "11,2 m²")
    rect(48, 22, 16, 18, "DORM. 3", "9,6 m²")
    rect(24, 22, 24, 10, "COMEDOR")
    # cotas
    d.line([(ox, oy - 80), (ox + 64 * s, oy - 80)], fill=(40, 40, 40), width=3)
    d.text((ox + 30 * s, oy - 130), "16,40", fill=(40, 40, 40), font=font(34))
    d.text((80, ph - 160), "PLANO VIVIENDA 3º B — ESTADO ACTUAL (copia)", fill=(40, 40, 40), font=font(40, True))
    d.text((80, ph - 105), "Escala aprox. 1:50 · Documento FICTICIO para demostración", fill=(90, 90, 90), font=font(30))
    if incompleto:
        img = img.rotate(1.4, expand=False, fillcolor=(236, 230, 214))
        img = img.crop((0, 0, int(pw * 0.62), ph))  # falta la parte derecha (dormitorios 2 y 3)
        img = img.filter(ImageFilter.GaussianBlur(1.3))
        noise = Image.effect_noise(img.size, 30).convert("L")
        img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.12)
        d2 = ImageDraw.Draw(img)
        d2.line([(img.width - 6, 0), (img.width - 30, img.height)], fill=(120, 110, 95), width=10)  # borde de hoja rota
        page = Image.new("RGB", (pw, ph), (236, 230, 214))
        page.paste(img, (0, 0))
        img = page
    img.save(ASSETS / name, "PDF", resolution=150)
    return ASSETS / name


# ------------------------------------------------------------------- nota simple
def nota_simple():
    path = ASSETS / "nota_simple_registro.pdf"
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4
    c.setFont("Helvetica-Bold", 12)
    c.drawString(25 * mm, h - 25 * mm, "REGISTRO DE LA PROPIEDAD DE MADRID Nº 99")
    c.setFont("Helvetica", 9)
    c.drawString(25 * mm, h - 31 * mm, "Calle Ficticia de la Demostración, 1 — 28000 Madrid")
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(w / 2, h - 45 * mm, "NOTA SIMPLE INFORMATIVA")
    c.setFont("Helvetica", 8.5)
    c.drawCentredString(w / 2, h - 51 * mm, "Fecha de emisión: 12/11/2026   ·   Referencia de la solicitud: F00DEMO123")
    y = h - 64 * mm

    def para(title, lines, gap=5.2):
        nonlocal y
        c.setFont("Helvetica-Bold", 10)
        c.drawString(25 * mm, y, title)
        y -= 6 * mm
        c.setFont("Helvetica", 9.5)
        for ln in lines:
            c.drawString(25 * mm, y, ln)
            y -= gap * mm
        y -= 3 * mm

    para("DESCRIPCIÓN DE LA FINCA", [
        "FINCA DE MADRID Nº: 54321        IDUFIR/CRU: 28099000123456",
        "Referencia catastral: 9872023VK4797A0015XQ",
        "URBANA: NÚMERO DOCE. Piso tercero, letra B, de la casa en Madrid, calle de Ibiza número 23.",
        "Situado en la planta tercera sin contar la baja. Superficie construida: ochenta y dos metros",
        "cuarenta decímetros cuadrados (82,40 m2). Superficie útil: setenta y un metros quince",
        "decímetros cuadrados (71,15 m2). Se distribuye en vestíbulo, pasillo, salón-comedor, tres",
        "dormitorios, cocina y un cuarto de baño. Cuota: 3,15 %.",
        "El edificio fue construido en el año 1958, según consta en la declaración de obra nueva.",
    ])
    para("TITULARIDAD", [
        "Doña LUCÍA FERNÁNDEZ ROMERO, NIF ****1234*, titular del 100 % del pleno dominio por título",
        "de herencia, según escritura otorgada el 03/05/2025. Inscripción 4ª, tomo 1234, libro 567, folio 89.",
    ])
    para("CARGAS", [
        "HIPOTECA a favor de BANCO EJEMPLO DEMO, S.A., en garantía de un préstamo, constituida en",
        "escritura de 14/02/2019, inscripción 3ª. Vigente.",
        "Afecta a las limitaciones fiscales derivadas de la herencia (5 años desde el 03/05/2025).",
    ])
    para("DOCUMENTOS PENDIENTES DE DESPACHO", ["No hay documentos pendientes de despacho."])
    c.setFont("Helvetica-Oblique", 7.5)
    c.drawString(25 * mm, 30 * mm, "Esta nota simple tiene valor puramente informativo (art. 222 Ley Hipotecaria).")
    c.saveState()
    c.setFillColorRGB(0.85, 0.2, 0.2)
    c.setFont("Helvetica-Bold", 30)
    c.translate(w / 2, h / 2)
    c.rotate(35)
    c.setFillAlpha(0.18)
    c.drawCentredString(0, 0, "DOCUMENTO FICTICIO · DEMO")
    c.restoreState()
    c.showPage()
    c.save()
    return path


def certificado_energetico(name, direccion, ref, calif="E"):
    path = ASSETS / name
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4
    c.setFont("Helvetica-Bold", 13)
    c.drawString(25 * mm, h - 28 * mm, "CERTIFICADO DE EFICIENCIA ENERGÉTICA DE EDIFICIOS")
    c.setFont("Helvetica", 9.5)
    y = h - 42 * mm
    for ln in [
        "Tipo de edificio: Vivienda individual en bloque",
        f"Dirección: {direccion}",
        f"Referencia catastral: {ref}",
        "Normativa vigente en construcción: anterior a NBE-CT-79",
        "Técnico certificador: Ingeniera Demo Ficticia · Nº colegiado 0000",
        "Fecha de emisión: 02/10/2026 · Validez: 10 años",
        "",
        f"CALIFICACIÓN ENERGÉTICA GLOBAL — Consumo de energía primaria no renovable: {calif}",
        f"Emisiones de dióxido de carbono: {calif}",
    ]:
        c.drawString(25 * mm, y, ln)
        y -= 6 * mm
    colors = [(0.1, 0.6, 0.2), (0.4, 0.7, 0.2), (0.7, 0.8, 0.2), (0.95, 0.85, 0.1), (0.95, 0.6, 0.1), (0.9, 0.35, 0.1), (0.85, 0.1, 0.1)]
    for i, col in enumerate(colors):
        c.setFillColorRGB(*col)
        c.rect(25 * mm, y - 10 * mm - i * 9 * mm, (40 + i * 12) * mm, 7 * mm, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.drawString(27 * mm, y - 8 * mm - i * 9 * mm, "ABCDEFG"[i])
    c.setFillColorRGB(0.8, 0.2, 0.2)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(25 * mm, 40 * mm, "DOCUMENTO FICTICIO · DEMO")
    c.showPage()
    c.save()
    return path


# ------------------------------------------------------------------------ correos
def eml(name, *, from_, to, subject, body, attachments=(), cc=None, date=None, headers=None):
    m = EmailMessage()
    m["From"] = from_
    m["To"] = to
    if cc:
        m["Cc"] = cc
    m["Subject"] = subject
    m["Date"] = format_datetime(date or datetime(2026, 11, 20, 9, 30, tzinfo=timezone.utc))
    m["Message-ID"] = make_msgid(domain="demo.wink")
    for k, v in (headers or {}).items():
        m[k] = v
    m.set_content(body)
    for p in attachments:
        p = Path(p)
        data = p.read_bytes()
        if p.suffix.lower() == ".pdf":
            m.add_attachment(data, maintype="application", subtype="pdf", filename=p.name)
        else:
            m.add_attachment(data, maintype="image", subtype="jpeg", filename=p.name)
    (OUT / name).write_bytes(bytes(m))
    print("·", name, f"({len(bytes(m)) // 1024} KB)")


def main():
    cocina, bano, salon, dorm, pasillo = foto_cocina(), foto_bano(), foto_salon(), foto_dormitorio(), foto_pasillo()
    # Duplicado: la misma foto del baño reenviada con otro nombre (WhatsApp)
    dup = ASSETS / "WhatsApp Image 2026-11-14 at 19.02.11 (1).jpeg"
    dup.write_bytes(bano.read_bytes())
    plano_inc = plano(True)
    plano_ok = plano(False, "plano_estado_actual_completo.pdf")
    nota = nota_simple()
    cee = certificado_energetico("certificado_energetico_ibiza23.pdf", "Calle de Ibiza 23, 3º B, 28009 Madrid", "9872023VK4797A0015XQ")
    cee2 = certificado_energetico("CEE_alcala_210.pdf", "Calle de Alcalá 210, 5º A, 28028 Madrid", "0011223VK4701B0042ZT", "F")

    # CASO 1 — reenvío de una persona de Wink, correo original desordenado
    eml(
        "caso1_reenvio_personal.eml",
        from_="Laura Martín <laura.martin@winkgroup.es>",
        to="Encargos Wink <prueba@aibetech.es>",
        subject="RV: piso abuela ibiza!!",
        body="""Os paso lo de Lucía, hablé con ella el martes por teléfono. Heredó el piso de su abuela y quiere reformarlo entero.
Me dijo que tiene 95 m2 pero me da que es menos, revisadlo con la nota simple que le pedí (va adjunta).
Lo quiere para antes del verano. De presupuesto habló de unos 80-90 mil pero no le he confirmado nada, ojo con eso.
Es muy maja pero un poco indecisa con la distribución.

Laura

---------- Mensaje reenviado ---------
De: Lucía Fernández <lucia.fernandez.demo@gmail.com>
Date: sáb, 14 nov 2026 a las 19:05
Subject: piso abuela ibiza!!
To: Laura Martín <laura.martin@winkgroup.es>

hola Laura!! como te dije x telefono, os mando las fotos del piso de mi abuela, es en c/ Ibiza 23 3ºB (Madrid). es de los años 50 y esta bastante viejo, hay humedades en el baño y el cuadro electrico es de los de plomos jaja

lo que queremos: hacerlo moderno, 3 dormitorios y 2 baños (ahora solo hay uno) y la cocina abierta al salon, que ahora es muy oscura. son unos 95 m2 creo

te mando tb un plano que tenia mi madre en un cajon, falta un trozo pero algo es algo. la nota simple la pedi al registro y te la reenvio aqui tb

nos gustaria empezar la obra en primavera y entrar a vivir antes del verano si puede ser. presupuesto aun no lo tenemos claro

no hay ascensor (es un tercero sin ascensor), por si importa para la obra

un beso!
Lucía
+34 600 123 456

Enviado desde mi iPhone
""",
        attachments=[cocina, bano, salon, dorm, pasillo, dup, plano_inc, nota],
    )

    # CASO 2 — el cliente escribe directamente
    eml(
        "caso2_cliente_directo.eml",
        from_="Jorge Martínez Ruiz <jorge.martinez.demo@outlook.es>",
        to="prueba@aibetech.es",
        subject="Solicitud de reforma integral – piso en Calle Alcalá",
        body="""Buenos días:

Me pongo en contacto con ustedes porque estamos interesados en una reforma integral de nuestro piso en la calle de Alcalá 210, 5º A (28028 Madrid). Es un edificio de 1975 con ascensor, la vivienda tiene unos 110 m² según la escritura.

Nos gustaría redistribuir para tener 3 dormitorios (uno de ellos tipo suite con baño), cocina abierta con isla, cambiar ventanas e instalaciones y poner suelo radiante si es posible.

Nuestro presupuesto orientativo es de 60.000-70.000 €, y nos gustaría poder entrar a vivir en septiembre de 2027.

Les adjunto un par de fotos y el certificado energético. La nota simple la tengo que pedir.

Un saludo,
Jorge Martínez Ruiz
Tel. 600 555 777

--
AVISO LEGAL: Este mensaje y sus anexos son confidenciales y van dirigidos exclusivamente a su destinatario.
""",
        attachments=[salon, cocina, cee2],
        date=datetime(2026, 11, 20, 8, 15, tzinfo=timezone.utc),
    )

    # CASO 2b — el mismo encargo llega reenviado por personal de Wink (debe unirse al expediente del caso 2)
    eml(
        "caso2b_mismo_encargo_personal.eml",
        from_="Carlos Ruiz <carlos.ruiz@winkgroup.es>",
        to="prueba@aibetech.es",
        subject="Fwd: Solicitud de reforma integral – piso en Calle Alcalá",
        body="""Este cliente me ha escrito también a mí. Lo he llamado y prefiere que le llamemos por las tardes.

---------- Forwarded message ---------
From: Jorge Martínez Ruiz <jorge.martinez.demo@outlook.es>
Date: vie, 20 nov 2026 a las 9:15
Subject: Solicitud de reforma integral – piso en Calle Alcalá
To: <carlos.ruiz@winkgroup.es>

Buenos días:

Me pongo en contacto con ustedes porque estamos interesados en una reforma integral de nuestro piso en la calle de Alcalá 210, 5º A (28028 Madrid). Es un edificio de 1975 con ascensor.

Un saludo,
Jorge Martínez Ruiz
Tel. 600 555 777
""",
    )

    # CASO 3 — encargo escrito por el personal SIN email del cliente
    eml(
        "caso3_personal_sin_email.eml",
        from_="Laura Martín <laura.martin@winkgroup.es>",
        to="prueba@aibetech.es",
        subject="Nuevo encargo tras llamada – Marta Gómez",
        body="""Hola,

Acabo de hablar por teléfono con Marta Gómez. Quiere una reforma integral de su piso en la calle de Embajadores 45, 2º izquierda. Edificio de 1930, unos 70 m², sin ascensor. Quiere ganar un segundo baño y cambiar toda la instalación eléctrica.
Su teléfono es el 600 987 654. No me dio el email, se lo pido.
Tiene prisa porque alquila el piso a partir de junio.

Laura
""",
    )
    eml(
        "caso3_respuesta_personal_email.eml",
        from_="Laura Martín <laura.martin@winkgroup.es>",
        to="prueba@aibetech.es",
        subject="Re: Faltan datos de contacto del cliente",
        body="""Su email es marta.gomez.demo@gmail.com

Laura
""",
    )

    # CASO 4 — no es un encargo
    eml(
        "caso4_no_encargo.eml",
        from_="Administración Suministros Demo <facturacion@suministros-demo.es>",
        to="prueba@aibetech.es",
        subject="Factura F-2026-1182 – pedido de material eléctrico",
        body="""Estimado cliente:

Le remitimos la factura F-2026-1182 correspondiente al pedido de material eléctrico entregado el 18/11/2026 en la obra de la calle Princesa.
Importe total: 1.284,50 € (IVA incluido). Vencimiento: 30 días.

Atentamente,
Departamento de Administración
""",
    )

    # Respuestas del cliente del caso 1 (se encadenan al hilo al inyectarlas)
    eml(
        "respuesta_cliente_documentos.eml",
        from_="Lucía Fernández <lucia.fernandez.demo@gmail.com>",
        to="prueba@aibetech.es",
        subject="Re: Documentación y visita – reforma de su vivienda",
        body="""Hola!

Os mando el certificado energético que tenía mi madre y he encontrado el plano completo en otra carpeta. La referencia catastral es la que pone en la nota simple.

Gracias!
Lucía
""",
        attachments=[cee, plano_ok],
    )
    eml(
        "respuesta_cliente_confirma_visita.eml",
        from_="Lucía Fernández <lucia.fernandez.demo@gmail.com>",
        to="prueba@aibetech.es",
        subject="Re: Documentación y visita – reforma de su vivienda",
        body="""Perfecto, nos viene genial la opción 2. Allí estaremos.

Lucía
""",
    )


if __name__ == "__main__":
    main()
