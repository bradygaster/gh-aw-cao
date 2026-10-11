import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'

const directory = dirname(fileURLToPath(import.meta.url))
const implementation = readFileSync(join(directory, '../internal/server/server.go'), 'utf8')
const openapi = JSON.parse(readFileSync(join(directory, 'generated/openapi.json'), 'utf8'))

test('every registered HTTP route has a TypeSpec operation (except static assets)', () => {
  const registered = [
    ...[...implementation.matchAll(/register\("(GET|POST) (\/[^"]+)"/g)]
      .map(([, method, path]) => `${method.toLowerCase()} ${path}`),
    ...[...implementation.matchAll(/mux\.Handle\("(GET|POST) (\/[^"]+)"/g)]
      .map(([, method, path]) => `${method.toLowerCase()} ${path}`)
  ].sort()
  const documented = Object.entries(openapi.paths)
    .flatMap(([path, operations]) => Object.keys(operations)
      .filter(method => ['get', 'post'].includes(method))
      .map(method => `${method} ${path}`))
    .sort()
  assert.deepEqual(documented, registered)
})

test('agent discovery describes public GET and body-free HEAD responses', () => {
  const operations = openapi.paths['/llms.txt']
  assert.ok(operations)
  for (const method of ['get', 'head']) {
    const operation = operations[method]
    assert.ok(operation, `${method} /llms.txt is documented`)
    assert.equal(operation.security, undefined, `${method} /llms.txt is public`)
    assert.deepEqual(operation.responses['200'].headers['Cache-Control'].schema.enum, ['no-store'])
    for (const status of ['429', '503']) {
      assert.ok(operation.responses[status], `${method} /llms.txt describes ${status}`)
    }
  }
  assert.equal(operations.get.responses['200'].content['text/plain; charset=utf-8'].schema.$ref, '#/components/schemas/AgentGuideText')
  assert.equal(openapi.components.schemas.AgentGuideText.type, 'string')
  assert.deepEqual(openapi.components.schemas.AgentGuideText.examples, [
    '# Central Agentic Ops dashboard server\n\nServer commit SHA: unknown\n'
  ])
  assert.deepEqual(operations.head.responses['200'].headers['content-type'].schema.enum, ['text/plain; charset=utf-8'])
  for (const status of ['429', '503']) {
    assert.ok(operations.get.responses[status].content['application/json'])
  }
  for (const response of Object.values(operations.head.responses)) {
    assert.equal(response.content, undefined, 'HEAD responses must not declare a body')
  }
})

test('the generated contract describes the implemented security and wire formats', () => {
  assert.equal(openapi.openapi, '3.1.0')
  assert.equal(openapi.info.version, '2.4.0')
  for (const path of ['/api/runs/{id}/jobs', '/api/runs/{id}/sessions', '/api/sessions/{id}/events']) {
    assert.equal(openapi.paths[path], undefined)
  }
  const query = openapi.paths['/api/v1/query'].post
  assert.ok(query.security.some(entry => 'BearerAuth' in entry))
  assert.ok(query.security.some(entry => 'ApiKeyAuth' in entry))
  assert.ok(query.responses['422'].content['application/json'])
  assert.ok(query.requestBody.content['application/json'])
  assert.ok(query.parameters.some(parameter => parameter.name === 'X-CSRF-Token'))
  assert.ok(openapi.paths['/api/auth/session'].get.security.some(entry => 'ApiKeyAuth' in entry))
  assert.equal(openapi.paths['/api/health'].get.security, undefined)
  assert.equal(openapi.paths['/api/github/webhook'].post.security, undefined)
  assert.ok(openapi.paths['/api/v1/events'].get.responses['200'].content['text/event-stream'])
  assert.ok(openapi.paths['/api/github/webhook'].post.responses['202'])
  const mcp = openapi.paths['/mcp'].post
  assert.ok(mcp.security.some(entry => 'BearerAuth' in entry))
  assert.ok(mcp.security.some(entry => 'ApiKeyAuth' in entry))
  assert.ok(mcp.parameters.some(parameter => parameter.name === 'X-CSRF-Token'))
  assert.ok(mcp.parameters.some(parameter => parameter.name === 'X-GitHub-Actor'))
  assert.ok(mcp.parameters.some(parameter => parameter.name === 'X-GitHub-OIDC-Token'))
  assert.ok(mcp.requestBody.content['application/json'])
  assert.ok(mcp.responses['200'].content['application/json'])
  assert.ok(mcp.responses['202'])
  assert.ok(mcp.responses['404'])
  assert.ok(openapi.paths['/api/admin/rebuild'].post.responses['202'])
  const logs = openapi.paths['/api/admin/logs'].get
  assert.ok(logs.security.some(entry => 'BearerAuth' in entry))
  assert.ok(logs.security.some(entry => 'ApiKeyAuth' in entry))
  assert.equal(logs.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/ServerLogSnapshot')
  assert.ok(logs.parameters.some(parameter => parameter.name === 'X-GitHub-Actor'))
  assert.ok(openapi.paths['/auth/logout'].post.responses['204'])
  assert.equal(openapi.components.securitySchemes.ApiKeyAuth.name, 'cao_session')
  for (const field of ['pushedDown', 'fallbackOperations']) {
    assert.ok(openapi.components.schemas.QueryMetrics.properties[field].anyOf.some(branch => branch.type === 'null'))
  }
  for (const field of ['redisCommands', 'redisRows']) {
    assert.equal(openapi.components.schemas.QueryMetrics.properties[field], undefined)
  }
  assert.equal(openapi.components.schemas.HealthResponse.properties.generation, undefined)
  for (const name of ['HealthResponse', 'ReadinessResponse']) {
    assert.equal(openapi.components.schemas[name].properties.operational.$ref, '#/components/schemas/OperationalState')
  }
  assert.deepEqual(openapi.components.schemas.OperationalCapability.properties.scope.enum, ['unsupported', 'process', 'deployment'])
  assert.deepEqual(openapi.components.schemas.OperationalCapability.properties.persistence.enum, ['volatile', 'restart'])
  assert.equal(openapi.components.schemas.RebuildStatus.properties.generation, undefined)
  assert.deepEqual(
    {
      type: openapi.components.schemas.DataState.properties.evaluatedAt.type,
      format: openapi.components.schemas.DataState.properties.evaluatedAt.format
    },
    { type: 'string', format: 'date-time' }
  )
})

test('structured payload fields stay in sync with Go JSON tags', () => {
  const pairs = [
    ['../internal/server/server.go', 'queryRequest', 'QueryRequest'],
    ['../internal/server/server.go', 'queryResponse', 'QueryResponse'],
    ['../internal/query/types.go', 'Definition', 'QueryDefinition'],
    ['../internal/query/types.go', 'Facet', 'Facet'],
    ['../internal/query/types.go', 'WindowField', 'WindowField'],
    ['../internal/query/types.go', 'OrderField', 'OrderField'],
    ['../internal/model/model.go', 'Source', 'QuerySource'],
    ['../internal/model/model.go', 'Metrics', 'QueryMetrics'],
    ['../internal/server/operations.go', 'rebuildStatus', 'RebuildStatus'],
    ['../internal/server/logs.go', 'serverLogSnapshot', 'ServerLogSnapshot'],
    ['../internal/server/logs.go', 'serverLogRedis', 'ServerLogRedis'],
    ['../internal/collect/recovery.go', 'Status', 'CollectionStatus'],
    ['../internal/githubquota/usage.go', 'UsageReport', 'QuotaUsage'],
    ['../internal/repositorymemory/memory.go', 'Campaign', 'MemoryCampaign']
  ]
  for (const [file, name, schema] of pairs) {
    const source = readFileSync(join(directory, file), 'utf8')
    const fields = source.match(new RegExp(`type ${name} struct \\{([\\s\\S]*?)\\n\\}`))?.[1]
    assert.ok(fields, `missing Go struct ${name}`)
    const goFields = [...fields.matchAll(/`json:"([^",]+)(?:,omitempty)?"`/g)]
      .map(([, field]) => field).sort()
    const definition = openapi.components.schemas[schema]
    const alternatives = definition.anyOf?.map(branch => openapi.components.schemas[branch.$ref.split('/').at(-1)])
      ?? [definition]
    const specFields = [...new Set(alternatives.flatMap(branch => Object.keys(branch.properties)))].sort()
    assert.deepEqual(specFields, goFields, `${schema} differs from ${file}:${name}`)
  }
})

test('generated facet contracts admit exactly the four axis alternatives', () => {
  const definition = JSON.parse(readFileSync(join(directory, 'generated/schemas/QueryDefinition.json'), 'utf8'))
  const request = JSON.parse(readFileSync(join(directory, 'generated/schemas/QueryRequest.json'), 'utf8'))
  const jsonValidator = new Ajv2020({ validateFormats: false })
  jsonValidator.addSchema(definition)
  const validateJson = jsonValidator.compile(request)
  // Move the OpenAPI component registry to $defs without changing schema semantics.
  const components = JSON.parse(JSON.stringify(openapi.components.schemas)
    .replaceAll('#/components/schemas/', '#/$defs/'))
  const validateOpenApi = new Ajv2020({ validateFormats: false }).compile({
    $defs: components,
    $ref: '#/$defs/QueryRequest'
  })
  for (const schemas of [openapi.components.schemas, definition.$defs]) {
    assert.equal(schemas.Facet.anyOf.length, 4)
    for (const [name, axes] of [
      ['FieldFacet', ['field']], ['RowFacet', ['row']],
      ['ColumnFacet', ['column']], ['GridFacet', ['row', 'column']]
    ]) {
      assert.deepEqual(schemas[name].required, [...axes, 'as'])
      assert.equal(schemas[name].additionalProperties, false)
    }
  }
  const cases = [
    { facet: undefined, valid: true },
    { facet: null, valid: false },
    { facet: { field: 'engine' }, valid: false },
    { facet: { field: 'engine', as: null }, valid: false },
    { facet: { field: 'engine', as: 1 }, valid: false },
    { facet: { field: 'engine', as: 'panels', unknown: 'axis' }, valid: false }
  ]
  const whitespace = '\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000'
  for (const axes of [{ field: 'engine' }, { row: 'repository' }, { column: 'workflow' }, { row: 'repository', column: 'workflow' }]) {
    for (const as of ['', ...whitespace, whitespace]) {
      cases.push({ facet: { ...axes, as }, valid: false })
    }
    for (const as of ['panels', `${whitespace}panels${whitespace}`, '\u200b', '\ufeff']) {
      cases.push({ facet: { ...axes, as }, valid: true })
    }
  }
  for (const field of [undefined, '', 'engine', null, 1, false, [], {}]) {
    for (const row of [undefined, '', 'repository', null, 1, false, [], {}]) {
      for (const column of [undefined, '', 'workflow', null, 1, false, [], {}]) {
        const axes = { field, row, column }
        const facet = { ...axes, as: 'panels' }
        const present = Object.entries(axes).filter(([, value]) => value !== undefined)
        const valid = present.length > 0
          && present.every(([, value]) => typeof value === 'string' && value.length > 0)
          && (field === undefined || present.length === 1)
        cases.push({ facet, valid })
      }
    }
  }
  for (const [name, validate] of [['OpenAPI', validateOpenApi], ['JSON Schema', validateJson]]) {
    for (const { facet, valid } of cases) {
      for (const property of ['queries', 'compiledQueries']) {
        // JSON transport omits undefined properties but retains null and empty strings.
        const input = JSON.parse(JSON.stringify({
          [property]: [{ name: 'panels', from: 'runs', facet }]
        }))
        assert.equal(validate(input), valid,
          `${name} ${JSON.stringify(input)}: ${JSON.stringify(validate.errors)}`)
      }
    }
  }
})

test('query contracts expose bounded window operations with canonical wire names', () => {
  const schemas = openapi.components.schemas
  const window = schemas.QueryDefinition.properties.window
  assert.equal(window.type, 'array')
  assert.equal(window.minItems, 1)
  assert.equal(window.maxItems, 8)
  assert.equal(window.items.$ref, '#/components/schemas/WindowField')
  assert.deepEqual(schemas.WindowField.required, ['operation', 'field', 'as', 'order-by'])
  assert.equal(schemas.WindowField.properties['order-by'].items.$ref, '#/components/schemas/OrderField')
  assert.equal(schemas.WindowField.properties['time-field'].type, 'string')
  assert.equal(schemas.WindowField.properties.groupby.items.type, 'string')
  assert.equal(schemas.WindowField.properties.frame.type, 'integer')
  const definition = JSON.parse(readFileSync(join(directory, 'generated/schemas/QueryDefinition.json'), 'utf8'))
  assert.deepEqual(definition.properties.window, {
    type: 'array', items: { $ref: '#/$defs/WindowField' }, minItems: 1, maxItems: 8
  })
  assert.deepEqual(Object.keys(definition.$defs.WindowField.properties).sort(),
    Object.keys(schemas.WindowField.properties).sort())
  const request = JSON.parse(readFileSync(join(directory, 'generated/schemas/QueryRequest.json'), 'utf8'))
  for (const field of ['queries', 'compiledQueries']) {
    assert.equal(request.properties[field].items.$ref, 'QueryDefinition.json')
  }
})

test('server log records preserve reserved wire names and date-time examples', () => {
  const record = openapi.components.schemas.ServerLogRecord
  assert.deepEqual(record.required, ['timestamp', 'namespace', 'message'])
  assert.deepEqual(record.properties, {
    timestamp: { type: 'string', format: 'date-time' },
    namespace: { type: 'string' },
    message: { type: 'string' }
  })
  assert.deepEqual(record.examples, [{
    timestamp: '2026-10-02T19:00:00Z',
    namespace: 'cao:server',
    message: 'listener ready'
  }])
  assert.equal(
    openapi.components.schemas.ServerLogSnapshot.properties.logs.items.$ref,
    '#/components/schemas/ServerLogRecord'
  )
})

test('the server-only MCP logs tool matches the HTTP snapshot contract', () => {
  const contract = JSON.parse(readFileSync(join(directory, '../../dashboard/site/src/agent/mcp-contract.json'), 'utf8'))
  assert.deepEqual(contract.tools.map(tool => tool.name), ['cao_catalog', 'cao_query'])
  assert.deepEqual(contract.serverTools.map(tool => tool.name), ['cao_logs'])
  const logs = contract.serverTools[0]
  assert.deepEqual(logs.inputSchema, { type: 'object', properties: {}, additionalProperties: false })
  assert.equal(logs.annotations.readOnlyHint, true)
  assert.equal(logs.annotations.untrustedContentHint, true)
  const schemas = openapi.components.schemas
  for (const [actual, expected] of [
    [logs.outputSchema, schemas.ServerLogSnapshot],
    [logs.outputSchema.properties.logs.items, schemas.ServerLogRecord],
    [logs.outputSchema.properties.redis, schemas.ServerLogRedis]
  ]) {
    assert.deepEqual(actual.required, expected.required)
    assert.deepEqual(Object.keys(actual.properties).sort(), Object.keys(expected.properties).sort())
  }
  assert.deepEqual(logs.outputSchema.properties.logs.items.properties, schemas.ServerLogRecord.properties)
  assert.deepEqual(
    logs.outputSchema.properties.redis.properties.status.enum.slice().sort(),
    schemas.ServerLogRedis.properties.status.enum.slice().sort()
  )
})

test('selected JSON Schemas and nullable responses are emitted', () => {
  for (const schema of ['QueryRequest', 'QueryResponse', 'QueryDefinition', 'RevisionEvent', 'WebhookAcknowledgement']) {
    const document = JSON.parse(readFileSync(join(directory, 'generated/schemas', `${schema}.json`), 'utf8'))
    assert.equal(document.$schema, 'https://json-schema.org/draft/2020-12/schema')
    assert.ok(document.properties)
  }
  assert.deepEqual(
    readdirSync(join(directory, 'generated/schemas')).sort(),
    ['QueryDefinition.json', 'QueryRequest.json', 'QueryResponse.json', 'RevisionEvent.json', 'WebhookAcknowledgement.json']
  )
  const campaign = openapi.paths['/api/v1/memory/{campaign}'].get.responses['200'].content['application/json'].schema
  assert.ok(campaign.anyOf.some(branch => branch.type === 'null'))
  for (const [path, response] of [
    ['/api/health', 'HealthResponse'],
    ['/api/v1/health', 'HealthResponse'],
    ['/api/readiness', 'ReadinessResponse']
  ]) {
    const schema = openapi.paths[path].get.responses['503'].content['application/json'].schema
    assert.ok(schema.anyOf.some(branch => branch.$ref === `#/components/schemas/${response}`), path)
    assert.ok(schema.anyOf.some(branch => branch.required?.includes('error')), path)
    assert.ok(openapi.paths[path].get.responses['429'].content['application/json'], path)
  }
})
