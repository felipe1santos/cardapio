const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agente', {
  carregarConfig: () => ipcRenderer.invoke('carregar-config'),
  salvarConfig: (patch) => ipcRenderer.invoke('salvar-config', patch),
  listarImpressorasWindows: () => ipcRenderer.invoke('listar-impressoras-windows'),
  testarPareamento: (token) => ipcRenderer.invoke('testar-pareamento', { token }),
  buscarImpressorasCloud: (token) => ipcRenderer.invoke('buscar-impressoras-cloud', { token }),
  testarImpressora: (args) => ipcRenderer.invoke('testar-impressora', args),
  onLog: (callback) => ipcRenderer.on('log', (_e, payload) => callback(payload)),
})
