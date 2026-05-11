// @ts-nocheck
let routeRenderer = async () => undefined;

function setRouteRenderer(handler) {
  routeRenderer = handler;
}

function renderRoute() {
  return routeRenderer();
}

function navigate(path) {
  history.pushState(null, "", path);
  renderRoute();
}


export { navigate, renderRoute, setRouteRenderer };
