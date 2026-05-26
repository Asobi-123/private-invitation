import { initializeApp } from "./core/app.js";

export function bootstrap() {
    jQuery(async () => {
        await initializeApp();
    });
}
