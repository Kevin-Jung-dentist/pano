import {guardAdminPage} from '../server/admin-page.mjs';
export const onRequest=context=>guardAdminPage(context.request,context.env,()=>context.next());
