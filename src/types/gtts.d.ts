declare module 'gtts' {
    interface GTTSOptions {
        lang?: string;
        slow?: boolean;
    }

    class GTTS {
        constructor(text: string, lang?: string, slow?: boolean);
        constructor(text: string, options?: GTTSOptions);
        
        save(filename: string, callback: (err: Error | null) => void): void;
        stream(): NodeJS.ReadableStream;
    }

    export = GTTS;
}