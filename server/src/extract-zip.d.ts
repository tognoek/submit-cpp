declare module "extract-zip" {
  type Options = {
    dir: string;
    onEntry?: (entry: { fileName: string }, zipfile: unknown) => void;
  };
  function extract(zipPath: string, opts: Options): Promise<void>;
  export default extract;
}
