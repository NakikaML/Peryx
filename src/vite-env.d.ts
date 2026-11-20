/// <reference types="vite/client" />

/**
 * Vite 的 `?url` 导入：返回打包后可用的资源地址。
 * pdf.js 的 worker 就是通过这种方式引入的（见 lib/pdf.ts）。
 */
declare module "*?url" {
  const src: string;
  export default src;
}
