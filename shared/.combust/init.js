import userStore from "../stores/UserStore";
import { firebaseConfig } from "./config";

export const stores = {
  userStore
};

export function initializeStores() {
  if (!firebaseConfig || !firebaseConfig.projectId) {
    return; //Firebase must be configured before initializing Combust stores
  }

  for (let storeName in stores) {
    const store = stores[storeName];
    store.init && store.init();
  }
}
