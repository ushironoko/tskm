// ../node_modules/.pnpm/@tskm+core@0.4.0/node_modules/@tskm/core/dist/index.mjs
/** Compact human-readable representation of a received value, for issue messages. */
function _received(value) {
	if (value === null) return "null";
	if (value === void 0) return "undefined";
	switch (typeof value) {
		case "string": return `"${value}"`;
		case "number": return String(value);
		case "object":
			if (Array.isArray(value)) return "Array";
			if (value instanceof Date) return "Date";
			return "Object";
		case "boolean": return String(value);
		case "bigint": return `${value}n`;
		case "symbol": return value.toString();
		case "function": return "Function";
		default: return "Object";
	}
}
/**
* Appends an issue to the dataset (mutating it in place, valibot-style). A
* `"schema"`-kind issue also marks the dataset untyped (wrong shape).
*/
function _addIssue(dataset, info, _config) {
	const received = _received(dataset.value);
	const message = info.message ?? (info.expected !== null ? `Invalid ${info.kind === "schema" ? "type" : info.type}: Expected ${info.expected} but received ${received}` : `Invalid ${info.type}: Received ${received}`);
	const issue = {
		kind: info.kind,
		type: info.type,
		expected: info.expected,
		received,
		message,
		input: dataset.value,
		path: info.path,
		severity: info.severity
	};
	const mutable = dataset;
	if (mutable.issues) mutable.issues.push(issue);
	else mutable.issues = [issue];
	if (info.kind === "schema" && (info.severity ?? "error") === "error") mutable.typed = false;
}
// @__NO_SIDE_EFFECTS__
function maxLength(requirement, message) {
	return {
		kind: "validation",
		type: "max_length",
		reference: maxLength,
		expects: `<=${requirement}`,
		async: false,
		requirement,
		message,
		"~run"(dataset, config) {
			if (dataset.typed && dataset.value.length > requirement) _addIssue(dataset, {
				kind: "validation",
				type: "max_length",
				expected: `<=${requirement}`,
				message
			}, config);
			return dataset;
		}
	};
}
// @__NO_SIDE_EFFECTS__
function maxValue(requirement, message) {
	return {
		kind: "validation",
		type: "max_value",
		reference: maxValue,
		expects: `<=${requirement instanceof Date ? requirement.toJSON() : requirement}`,
		async: false,
		requirement,
		message,
		"~run"(dataset, config) {
			if (dataset.typed && dataset.value > requirement) _addIssue(dataset, {
				kind: "validation",
				type: "max_value",
				expected: `<=${requirement instanceof Date ? requirement.toJSON() : requirement}`,
				message
			}, config);
			return dataset;
		}
	};
}
// @__NO_SIDE_EFFECTS__
function minLength(requirement, message) {
	return {
		kind: "validation",
		type: "min_length",
		reference: minLength,
		expects: `>=${requirement}`,
		async: false,
		requirement,
		message,
		"~run"(dataset, config) {
			if (dataset.typed && dataset.value.length < requirement) _addIssue(dataset, {
				kind: "validation",
				type: "min_length",
				expected: `>=${requirement}`,
				message
			}, config);
			return dataset;
		}
	};
}
// @__NO_SIDE_EFFECTS__
function minValue(requirement, message) {
	return {
		kind: "validation",
		type: "min_value",
		reference: minValue,
		expects: `>=${requirement instanceof Date ? requirement.toJSON() : requirement}`,
		async: false,
		requirement,
		message,
		"~run"(dataset, config) {
			if (dataset.typed && dataset.value < requirement) _addIssue(dataset, {
				kind: "validation",
				type: "min_value",
				expected: `>=${requirement instanceof Date ? requirement.toJSON() : requirement}`,
				message
			}, config);
			return dataset;
		}
	};
}
/** True only for an exact `"warning"` severity (the single non-fatal value). */
function isWarningIssue(issue) {
	return issue.severity === "warning";
}
/**
* True if the issue fails a parse. Fail-closed: ONLY an exact `"warning"` is non-fatal, so
* an absent, `"error"`, or unknown/typo severity (a JS or `as any` caller could pass one
* through the public `ctx.issue` API) is treated as an error and stays visible, never
* silently swallowed into a successful parse.
*/
function isErrorIssue(issue) {
	return !isWarningIssue(issue);
}
/** True if any issue in the list is error-severity (i.e. the parse failed). */
function hasErrorIssue(issues) {
	return issues?.some(isErrorIssue) ?? false;
}
const URLCtor = globalThis.URL;
function isUrl(input) {
	try {
		new URLCtor(input);
		return true;
	} catch {
		return false;
	}
}
// @__NO_SIDE_EFFECTS__
function url(message) {
	return {
		kind: "validation",
		type: "url",
		reference: url,
		expects: null,
		async: false,
		requirement: isUrl,
		message,
		"~run"(dataset, config) {
			if (dataset.typed && !isUrl(dataset.value)) _addIssue(dataset, {
				kind: "validation",
				type: "url",
				expected: null,
				message
			}, config);
			return dataset;
		}
	};
}
/** Frozen default config — there is no global mutable configuration in tskm. */
const defaultConfig = Object.freeze({});
/** True if the run should bail at the first error (reject mode, or the legacy abortEarly). */
function isReject(config) {
	return config.mode === "reject" || config.abortEarly === true;
}
const VENDOR = "tskm";
const cache = /* @__PURE__ */ new WeakMap();
function toStandardIssue(issue) {
	return issue.path ? {
		message: issue.message,
		path: issue.path
	} : { message: issue.message };
}
function toResult(dataset) {
	const errors = dataset.issues?.filter(isErrorIssue);
	return errors && errors.length > 0 ? { issues: errors.map(toStandardIssue) } : { value: dataset.value };
}
/**
* Returns the (memoized) Standard Schema props for a schema. Memoization is keyed
* by the schema object in a module-level WeakMap, so there is no global mutable
* accumulation (entries are collected with the schema).
*/
function _getStandardProps(schema) {
	const cached = cache.get(schema);
	if (cached) return cached;
	const props = {
		version: 1,
		vendor: VENDOR,
		validate(value) {
			const dataset = schema["~run"]({ value }, defaultConfig);
			return dataset instanceof Promise ? dataset.then(toResult) : toResult(dataset);
		}
	};
	cache.set(schema, props);
	return props;
}
// @__NO_SIDE_EFFECTS__
function array(item, message) {
	return {
		kind: "schema",
		type: "array",
		reference: array,
		expects: "Array",
		async: false,
		item,
		message,
		get "~standard"() {
			return _getStandardProps(this);
		},
		"~run"(dataset, config) {
			const out = dataset;
			const input = out.value;
			if (Array.isArray(input)) {
				out.typed = true;
				const output = [];
				let aborted = false;
				for (let index = 0; index < input.length; index++) {
					const itemDataset = item["~run"]({ value: input[index] }, config);
					if (itemDataset.issues) {
						const head = { key: index };
						for (const issue of itemDataset.issues) issue.path = issue.path ? [head, ...issue.path] : [head];
						_pushIssues$6(out, itemDataset.issues);
						if (hasErrorIssue(itemDataset.issues) && isReject(config)) {
							out.typed = false;
							aborted = true;
							break;
						}
					}
					if (!itemDataset.typed) out.typed = false;
					output.push(itemDataset.value);
				}
				if (!aborted) out.value = output;
			} else _addIssue(dataset, {
				kind: "schema",
				type: "array",
				expected: "Array",
				message
			}, config);
			return out;
		}
	};
}
function _pushIssues$6(dataset, incoming) {
	let target = dataset.issues;
	if (target === void 0) {
		target = [];
		dataset.issues = target;
	}
	for (let i = 0; i < incoming.length; i++) target.push(incoming[i]);
}
// @__NO_SIDE_EFFECTS__
function number(message) {
	return {
		kind: "schema",
		type: "number",
		reference: number,
		expects: "number",
		async: false,
		message,
		get "~standard"() {
			return _getStandardProps(this);
		},
		"~run"(dataset, config) {
			const out = dataset;
			if (typeof out.value === "number" && !Number.isNaN(out.value)) out.typed = true;
			else _addIssue(dataset, {
				kind: "schema",
				type: "number",
				expected: "number",
				message
			}, config);
			return out;
		}
	};
}
/**
* Assigns `value` to `target[key]` as an own data property, safe against a `__proto__`
* input key. A plain `target[key] = value` for `key === "__proto__"` would mutate the
* object's prototype instead of creating an own property (silently dropping the key and
* corrupting the prototype), so a fresh-output object copying attacker-shaped input keys
* must route through here.
*/
function _safeAssign(target, key, value) {
	if (key === "__proto__") {
		Object.defineProperty(target, key, {
			value,
			enumerable: true,
			configurable: true,
			writable: true
		});
		return;
	}
	target[key] = value;
}
// @__NO_SIDE_EFFECTS__
function object(entries, arg) {
	const options = typeof arg === "string" ? { message: arg } : arg ?? {};
	const message = options.message;
	const optionalKeys = options.optionalKeys === true;
	const rest = options.rest ?? "strip";
	const keyList = Object.keys(entries);
	const schemaList = keyList.map((k) => entries[k]);
	return {
		kind: "schema",
		type: "object",
		reference: object,
		expects: "Object",
		async: false,
		entries,
		message,
		optionalKeys,
		rest,
		get "~standard"() {
			return _getStandardProps(this);
		},
		"~run"(dataset, config) {
			const out = dataset;
			const input = out.value;
			if (input !== null && typeof input === "object" && !Array.isArray(input)) {
				out.typed = true;
				const record = input;
				const output = {};
				let aborted = false;
				for (let i = 0; i < keyList.length; i++) {
					const key = keyList[i];
					const valueSchema = schemaList[i];
					const valueDataset = valueSchema["~run"]({ value: record[key] }, config);
					if (valueDataset.issues) {
						const head = { key };
						for (const issue of valueDataset.issues) issue.path = issue.path ? [head, ...issue.path] : [head];
						_pushIssues$5(out, valueDataset.issues);
						if (hasErrorIssue(valueDataset.issues) && isReject(config)) {
							out.typed = false;
							aborted = true;
							break;
						}
					}
					if (!valueDataset.typed) out.typed = false;
					if (optionalKeys && valueDataset.value === void 0 && (valueSchema.type === "optional" || valueSchema.type === "nullish")) continue;
					_safeAssign(output, key, valueDataset.value);
				}
				if (!aborted && rest !== "strip") aborted = _applyRest(dataset, record, entries, output, rest, message, config);
				if (!aborted) out.value = output;
			} else _addIssue(dataset, {
				kind: "schema",
				type: "object",
				expected: "Object",
				message
			}, config);
			return out;
		}
	};
}
/**
* Applies the non-strip unknown-key policy after the declared entries are walked: in
* `passthrough` mode it copies each undeclared input key onto the output; in `exact` mode
* it pushes a path-precise issue per undeclared key (honoring `abortEarly`). Shared by
* `object` and `objectAsync`. Returns `true` if it aborted early.
*/
function _applyRest(dataset, record, entries, output, rest, message, config) {
	for (const key of Object.keys(record)) {
		if (Object.hasOwn(entries, key)) continue;
		if (rest === "passthrough") _safeAssign(output, key, record[key]);
		else {
			_addIssue(dataset, {
				kind: "schema",
				type: "object",
				expected: null,
				message: message ?? `Unexpected key "${key}"`,
				path: [{ key }]
			}, config);
			if (isReject(config)) return true;
		}
	}
	return false;
}
function _pushIssues$5(dataset, incoming) {
	let target = dataset.issues;
	if (target === void 0) {
		target = [];
		dataset.issues = target;
	}
	for (let i = 0; i < incoming.length; i++) target.push(incoming[i]);
}
// @__NO_SIDE_EFFECTS__
function string(message) {
	return {
		kind: "schema",
		type: "string",
		reference: string,
		expects: "string",
		async: false,
		message,
		get "~standard"() {
			return _getStandardProps(this);
		},
		"~run"(dataset, config) {
			const out = dataset;
			if (typeof out.value === "string") out.typed = true;
			else _addIssue(dataset, {
				kind: "schema",
				type: "string",
				expected: "string",
				message
			}, config);
			return out;
		}
	};
}
const captureStackTrace = Error.captureStackTrace;
/**
* Creates a validation error without defining a class (honors the no-class rule)
* while remaining `instanceof Error` for ecosystem interop.
*/
function tskmError(issues) {
	const message = issues[0]?.message ?? "Validation failed";
	const error = new Error(message);
	error.name = "TskmError";
	error.issues = issues;
	captureStackTrace?.(error, tskmError);
	return error;
}
/**
* Parses `input` against a (synchronous) schema, returning the typed output or
* throwing a {@link tskmError}. Accepts only sync schemas — an async schema is a
* compile-time error (use `parseAsync`). Throws only on `"error"`-severity issues;
* `"warning"`s do not throw (and are not surfaced by `parse` — use `safeParse`).
*/
function parse(schema, input, config = defaultConfig) {
	const dataset = schema["~run"]({ value: input }, config);
	if (hasErrorIssue(dataset.issues)) throw tskmError((dataset.issues ?? []).filter(isErrorIssue));
	return dataset.value;
}
/**
* Composes a schema with a sequence of validation/transformation actions.
* Returns a new schema; the original is untouched.
*/
// @__NO_SIDE_EFFECTS__
function pipe(schema, ...items) {
	const steps = items.filter((item) => item.kind !== "metadata").map((item) => item.kind === "transformation" ? {
		isTransform: true,
		item
	} : {
		isTransform: false,
		item
	});
	return {
		...schema,
		pipe: [schema, ...items],
		get "~standard"() {
			return _getStandardProps(this);
		},
		"~run"(dataset, config) {
			let current = schema["~run"](dataset, config);
			for (const { item, isTransform } of steps) {
				if (hasErrorIssue(current.issues) && (isReject(config) || config.abortPipeEarly)) break;
				if (isTransform) {
					if (current.typed) current = item["~run"](current, config);
				} else current = item["~run"](current, config);
			}
			return current;
		}
	};
}
// @__NO_SIDE_EFFECTS__
function date(message) {
	return {
		kind: "schema",
		type: "date",
		reference: date,
		expects: "Date",
		async: false,
		message,
		get "~standard"() {
			return _getStandardProps(this);
		},
		"~run"(dataset, config) {
			const out = dataset;
			if (out.value instanceof Date && !Number.isNaN(out.value.getTime())) out.typed = true;
			else _addIssue(dataset, {
				kind: "schema",
				type: "date",
				expected: "Date",
				message
			}, config);
			return out;
		}
	};
}
// @__NO_SIDE_EFFECTS__
function nullable(wrapped, default_) {
	return {
		kind: "schema",
		type: "nullable",
		reference: nullable,
		expects: `(${wrapped.expects} | null)`,
		async: false,
		wrapped,
		default: default_,
		get "~standard"() {
			return _getStandardProps(this);
		},
		"~run"(dataset, config) {
			const out = dataset;
			if (out.value === null) {
				const fallback = typeof default_ === "function" ? default_() : default_;
				out.typed = true;
				out.value = default_ === void 0 ? null : fallback;
				return out;
			}
			return wrapped["~run"](dataset, config);
		}
	};
}
// @__NO_SIDE_EFFECTS__
function picklist(options, message) {
	const allowed = new Set(options);
	const expected = options.map((option) => typeof option === "string" ? `"${option}"` : `${option}`).join(" | ");
	return {
		kind: "schema",
		type: "picklist",
		reference: picklist,
		expects: expected,
		async: false,
		options,
		message,
		get "~standard"() {
			return _getStandardProps(this);
		},
		"~run"(dataset, config) {
			const out = dataset;
			if (allowed.has(out.value)) out.typed = true;
			else _addIssue(dataset, {
				kind: "schema",
				type: "picklist",
				expected,
				message
			}, config);
			return out;
		}
	};
}
// ../schemas/libraries/tskm/index.ts
function boundedString(min, max) {
	return /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ minLength(min), /* @__PURE__ */ maxLength(max));
}
function boundedNumber(min, max) {
	return /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ minValue(min), /* @__PURE__ */ maxValue(max));
}
const imageSchema = /* @__PURE__ */ object({
	id: /* @__PURE__ */ number(),
	created: /* @__PURE__ */ date(),
	title: boundedString(1, 100),
	type: /* @__PURE__ */ picklist(["jpg", "png"]),
	size: /* @__PURE__ */ number(),
	url: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ url())
});
const ratingSchema = /* @__PURE__ */ object({
	id: /* @__PURE__ */ number(),
	stars: boundedNumber(1, 5),
	title: boundedString(1, 100),
	text: boundedString(1, 1e3),
	images: /* @__PURE__ */ array(imageSchema)
});
// ../schemas/libraries/tskm/download/index.ts
parse(/* @__PURE__ */ object({
	id: /* @__PURE__ */ number(),
	created: /* @__PURE__ */ date(),
	title: boundedString(1, 100),
	brand: boundedString(1, 30),
	description: boundedString(1, 500),
	price: boundedNumber(1, 1e4),
	discount: /* @__PURE__ */ nullable(boundedNumber(1, 100)),
	quantity: boundedNumber(0, 10),
	tags: /* @__PURE__ */ array(boundedString(1, 30)),
	images: /* @__PURE__ */ array(imageSchema),
	ratings: /* @__PURE__ */ array(ratingSchema)
}), {});
