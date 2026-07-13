// HTML files are bundled as text modules (wrangler's default `.html` Text rule).
declare module '*.html' {
  const content: string
  export default content
}
