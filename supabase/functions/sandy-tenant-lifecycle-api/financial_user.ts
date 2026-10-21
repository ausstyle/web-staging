import download from "./financial_download_contract.json" with { type: "json" };
import available from "./financial_available_contract.json" with {
  type: "json",
};
import {
  createUserFragmentAvailable,
  createUserFragmentDownload,
} from "./fragment_user_handlers.ts";
export const financialExportDownloadOperation = Object.freeze(download);
export const financialExportAvailableOperation = Object.freeze(available);
export const executeFinancialExportDownload = createUserFragmentDownload(
  download,
  "sandy_tenant_financial_fragment_download",
);
export const executeFinancialExportAvailable = createUserFragmentAvailable(
  available,
  "sandy_tenant_financial_exports_available",
);
