declare module 'pdfmake/fonts/Roboto' {
  interface RobotoFontFamily {
    normal: string;
    bold: string;
    italics: string;
    bolditalics: string;
  }

  const fonts: { Roboto: RobotoFontFamily };
  export = fonts;
}
