export interface UseDebouncedCallbackOptions {
    delay: number;
    flushOnUnmount?: boolean;
    leading?: boolean;
}
export type UseDebouncedCallbackReturnValue<T extends (...args: any[]) => any> = ((...args: Parameters<T>) => void) & {
    flush: () => void;
};
export declare function useDebouncedCallback<T extends (...args: any[]) => any>(callback: T, options: number | UseDebouncedCallbackOptions): ((...args: Parameters<T>) => void) & {
    flush: () => void;
};
