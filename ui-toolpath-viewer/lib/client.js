// Compatibility bundle only. camind-ui-model-viewer now owns cam.nc.preview and the WebGL2 scene.
window.__ModuleLoader__.load({ id: 'camind-ui-toolpath-viewer', factory: (require) => {
  require('camind-ui-model-viewer')
  return { name: 'camind-ui-toolpath-viewer', apply() {} }
} })
