const WRITER_ENVIRONMENT_KEYS = Object.freeze([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "CODEX_HOME",
    "TERM",
    "NO_COLOR",
    "AUTO_ENGINE",
    "CODEX_MODEL",
    "AUTO_BEST_OF",
    "AUTO_MAX_PASSES",
    "AUTO_ENHANCE_PASSES",
]);

/** Return only non-secret process variables needed by the writer and Codex. */
export function buildWriterEnvironment(source = process.env) {
    const environment = Object.fromEntries(
        WRITER_ENVIRONMENT_KEYS.filter(
            (key) => typeof source?.[key] === "string",
        ).map((key) => [key, source[key]]),
    );
    return Object.freeze(environment);
}
