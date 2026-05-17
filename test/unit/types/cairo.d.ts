declare module "gi://cairo" {
  const Cairo: {
    Context: {
      new (): unknown;
    };
    FontSlant: {
      NORMAL: 0;
      ITALIC: 1;
      OBLIQUE: 2;
    };
    FontWeight: {
      NORMAL: 0;
      BOLD: 1;
    };
  };
  export default Cairo;
}
