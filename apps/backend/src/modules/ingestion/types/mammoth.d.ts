/**
 * Minimal ambient types for `mammoth` (the package ships no type
 * declarations and none exist on DefinitelyTyped). Only the API surface
 * Nexus uses is declared.
 */
declare module 'mammoth' {
  export interface ExtractResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export interface ExtractOptions {
    /** Path to the .docx file. */
    path?: string;
    /** Buffer containing the .docx file. */
    buffer?: Buffer;
  }

  /** Extract plain text from a .docx document. */
  export function extractRawText(
    options: ExtractOptions,
  ): Promise<ExtractResult>;
}
