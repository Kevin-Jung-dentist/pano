import {handle} from "../../server/api.mjs";
export const onRequest=context=>handle(context.request,context.env);
