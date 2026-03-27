; ── Attacca NSIS Installer Customization ─────────────────────────────────────
; Included by electron-builder before MUI2.nsh.
; Only safe color/text defines that don't conflict with electron-builder.

; Brand colors (dark navy theme)
!define MUI_BGCOLOR "0A0E27"
!define MUI_TEXTCOLOR "F5F5FF"

; Abort warning
!define MUI_ABORTWARNING

; Branding text at bottom of installer
BrandingText "AttaccaClaw — AI Productivity Assistant"

; ── Extract openclaw node_modules from 7z archive ────────────────────────────
; The afterPack hook packs openclaw/node_modules into a single .7z file to avoid
; writing 13,000+ individual files during NSIS install. This macro extracts them.
!macro customInstall
  ${if} ${FileExists} "$INSTDIR\resources\openclaw\openclaw-deps.7z"
    DetailPrint "Extracting OpenClaw dependencies..."
    nsExec::ExecToLog '"$INSTDIR\resources\openclaw\7za.exe" x "$INSTDIR\resources\openclaw\openclaw-deps.7z" -o"$INSTDIR\resources\openclaw" -aoa -y'
    Pop $0
    ${if} $0 != "0"
      DetailPrint "Warning: 7z extraction returned code $0"
    ${endif}
    Delete "$INSTDIR\resources\openclaw\openclaw-deps.7z"
    Delete "$INSTDIR\resources\openclaw\7za.exe"
    DetailPrint "OpenClaw dependencies extracted."
  ${endif}
!macroend
