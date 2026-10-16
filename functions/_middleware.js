import {guardAdminPage,adminAssetResponse} from '../server/admin-page.mjs';
export const onRequest=context=>guardAdminPage(context.request,context.env,()=>adminAssetResponse(context.request)||context.next());
