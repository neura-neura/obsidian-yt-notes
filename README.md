<p align="center">
  <img src="assets/icons/hover-notes-icon.svg" alt="Obsidian YT Notes icon" width="160" />
</p>

# Obsidian YT Notes

Extension de navegador para tomar notas Markdown locales mientras ves videos. Guarda tus notas en la carpeta que elijas, pensada para convivir con un vault de Obsidian sin depender de servicios externos.

![Ventana de notas de Obsidian YT Notes](assets/readme/notes-window.png)

## Caracteristicas

- Panel de notas integrado para videos y modo flotante.
- Guardado local en archivos Markdown dentro de una carpeta seleccionada por el usuario.
- Metadatos de fuente para conservar la URL del video junto con la nota.
- Atajos de teclado para abrir notas, mostrar el boton flotante y controlar reproduccion.
- Insercion de timestamps en formato de lista o linea simple.
- Soporte para tema claro, oscuro o segun el sistema.
- Lista de sitios bloqueados para desactivar la extension donde no la quieras usar.
- UI localizada mediante `_locales`.

## Instalacion local

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` en Chrome, Edge o cualquier navegador compatible con extensiones Chromium.
3. Activa **Developer mode**.
4. Haz clic en **Load unpacked**.
5. Selecciona la carpeta del proyecto.
6. Abre las opciones de la extension y elige la carpeta donde quieres guardar tus notas.

Para usarla con videos locales, habilita **Allow access to file URLs** desde la tarjeta de la extension en `chrome://extensions`.

## Uso rapido

- Abre un video en YouTube u otra plataforma.
- Usa el popup de la extension para abrir la carpeta de notas o las notas del video actual.
- Conecta una carpeta local cuando el panel lo solicite.
- Escribe, edita y guarda tus notas en Markdown.

Atajos incluidos por defecto:

- `Alt+Shift+O`: abrir el panel de notas.
- `Alt+Shift+F`: abrir el panel flotante.
- `Command+Shift+O` y `Command+Shift+F` en macOS.

## Estructura

- `manifest.json`: manifiesto de extension MV3.
- `content-script.js` y `video-hover-button.js`: integracion con paginas y reproductores.
- `editor.html`, `editor.css`, `editor.js`: ventana principal de notas.
- `popup.html`, `popup.css`, `popup.js`: popup de la extension.
- `options.html`, `options.css`, `options.js`: configuracion.
- `assets/`: iconos, fuentes y recursos visuales.
- `models/`: modelos locales usados por las funciones de deteccion incluidas.

## Desarrollo

No requiere build para probarse como extension desempaquetada. Despues de editar los archivos, recarga la extension desde `chrome://extensions` y vuelve a cargar la pagina donde la estes usando.

## Licencia

Agrega aqui la licencia que prefieras antes de distribuir publicamente el proyecto.
