import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(content: string): string {
	return DOMPurify.sanitize(marked.parse(content) as string);
}
