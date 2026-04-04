import process from "node:process";

export async function runApp(main) {
  try {
    await main();
  } catch (error) {
    console.error(error);

    if (process.pkg) {
      console.log("");
      console.log("\u30a2\u30d7\u30ea\u306e\u5b9f\u884c\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
      console.log(
        "Chrome \u304c\u65e2\u306b\u8d77\u52d5\u3057\u3066\u3044\u308b\u5834\u5408\u306f\u3001\u3044\u3063\u305f\u3093\u9589\u3058\u3066\u304b\u3089\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
      );
      console.log(
        "\u3053\u306e\u753b\u9762\u3092\u9589\u3058\u308b\u306b\u306f Enter \u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
      );
      try {
        await new Promise((resolve) => {
          process.stdin.resume();
          process.stdin.once("data", resolve);
        });
      } catch {
        // ignore
      }
    }

    process.exit(1);
  }
}
