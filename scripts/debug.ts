import { catalogFromWorkbook, mergeCatalog, readCatalog } from '../core/viewer/catalog.ts'
const { catalog } = await catalogFromWorkbook(process.argv[2])
const base = readCatalog('data/catalog.json')!
const { report } = mergeCatalog(base, catalog); console.log(report)
