// @ts-check
import { module } from "@prisma/composer";
import docsService from "./apps/docs/service.mjs";
import webService from "./apps/web/service.mjs";

export default module("docs", ({ provision }) => {
  provision(docsService);
  provision(webService);
});
