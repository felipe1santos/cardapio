const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agente', {
  carregarConfig: () => ipcRenderer.invoke('carregar-config'),
  salvarConfig: (patch) => ipcRenderer.invoke('salvar-config', patch),
  listarImpressorasWindows: () => ipcRenderer.invoke('listar-impressoras-windows'),
  testarPareamento: (args) => ipcRenderer.invoke('testar-pareamento', args),
  buscarImpressorasCloud: (args) => ipcRenderer.invoke('buscar-impressoras-cloud', args),
  testarImpressora: (args) => ipcRenderer.invoke('testar-impressora', args),
  onLog: (callback) => ipcRenderer.on('log', (_e, payload) => callback(payload)),
})
