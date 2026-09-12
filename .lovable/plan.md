# Simplify FloatingSpace into one chat experience

## Result
- Make chat the main screen, with no separate home-style dashboard.
- Put image generation and PDF upload directly in the chat composer.
- Reduce navigation and controls so the mobile experience feels focused and easy.

## Changes
1. **Single main screen**
   - Send `/` directly into the chat experience.
   - Keep history and profile accessible from the chat header.
   - Remove the five-item bottom navigation from the focused chat screen.

2. **One composer for everything**
   - Add a compact tool picker for normal chat, image creation, and PDF upload.
   - In image mode, generate the image from the typed prompt and show the finished image in the conversation.
   - For PDFs, show the selected file above the composer and let the user ask a question or request a summary in the same message.

3. **Simpler visual design**
   - Use a quiet header, spacious message area, clear empty state, and one compact composer.
   - Keep the existing FloatingSpace visual identity and accent color while reducing decorative surfaces and duplicate controls.
   - Preserve existing login, conversation storage, streaming responses, and AI endpoints.

## Technical details
- Compose the chat with AI Elements conversation, message, prompt-input, attachment, and loading primitives.
- Reuse the existing image-generation endpoint and PDF attachment flow; no database or authentication changes.
- Redirect the old image and PDF pages into chat so existing links remain valid.
- Add page-specific metadata and verify the main flow at mobile and desktop sizes.
