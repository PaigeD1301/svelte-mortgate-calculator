var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function to_number(value) {
        return value === '' ? null : +value;
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src/App.svelte generated by Svelte v3.55.1 */

    function create_if_block(ctx) {
    	let button;
    	let t0;
    	let t1_value = /*formatter*/ ctx[6].format(/*monthlyPayment*/ ctx[4]) + "";
    	let t1;

    	return {
    		c() {
    			button = element("button");
    			t0 = text("MONTHLY PAYMENT: ");
    			t1 = text(t1_value);
    			attr(button, "class", "outputs");
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    			append(button, t0);
    			append(button, t1);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*monthlyPayment*/ 16 && t1_value !== (t1_value = /*formatter*/ ctx[6].format(/*monthlyPayment*/ ctx[4]) + "")) set_data(t1, t1_value);
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let main;
    	let div6;
    	let h1;
    	let t1;
    	let div0;
    	let label0;
    	let t3;
    	let input0;
    	let t4;
    	let div1;
    	let label1;
    	let t6;
    	let input1;
    	let t7;
    	let div2;
    	let label2;
    	let t9;
    	let input2;
    	let t10;
    	let div3;
    	let label3;
    	let t12;
    	let input3;
    	let t13;
    	let div4;
    	let label4;
    	let t15;
    	let input4;
    	let t16;
    	let div5;
    	let button;
    	let t18;
    	let mounted;
    	let dispose;
    	let if_block = /*monthlyPayment*/ ctx[4] && create_if_block(ctx);

    	return {
    		c() {
    			main = element("main");
    			div6 = element("div");
    			h1 = element("h1");
    			h1.textContent = "Mortgate Calculator";
    			t1 = space();
    			div0 = element("div");
    			label0 = element("label");
    			label0.textContent = "Home Value";
    			t3 = space();
    			input0 = element("input");
    			t4 = space();
    			div1 = element("div");
    			label1 = element("label");
    			label1.textContent = "Down Payment";
    			t6 = space();
    			input1 = element("input");
    			t7 = space();
    			div2 = element("div");
    			label2 = element("label");
    			label2.textContent = "Loan Amount";
    			t9 = space();
    			input2 = element("input");
    			t10 = space();
    			div3 = element("div");
    			label3 = element("label");
    			label3.textContent = "Loan Term (years)";
    			t12 = space();
    			input3 = element("input");
    			t13 = space();
    			div4 = element("div");
    			label4 = element("label");
    			label4.textContent = "Interest Rate (%)";
    			t15 = space();
    			input4 = element("input");
    			t16 = space();
    			div5 = element("div");
    			button = element("button");
    			button.textContent = "CALCULATE";
    			t18 = space();
    			if (if_block) if_block.c();
    			attr(input0, "type", "number");
    			attr(div0, "class", "input-field");
    			attr(input1, "type", "number");
    			attr(div1, "class", "input-field");
    			attr(input2, "type", "number");
    			attr(div2, "class", "input-field");
    			attr(label3, "for", "");
    			attr(input3, "type", "number");
    			attr(div3, "class", "input-field");
    			attr(input4, "type", "number");
    			attr(input4, "step", "0.1");
    			attr(div4, "class", "input-field");
    			attr(button, "class", "btn");
    			attr(div5, "class", "btn-container");
    			attr(div6, "class", "container");
    			attr(main, "class", "hero");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, div6);
    			append(div6, h1);
    			append(div6, t1);
    			append(div6, div0);
    			append(div0, label0);
    			append(div0, t3);
    			append(div0, input0);
    			set_input_value(input0, /*homeValue*/ ctx[0]);
    			append(div6, t4);
    			append(div6, div1);
    			append(div1, label1);
    			append(div1, t6);
    			append(div1, input1);
    			set_input_value(input1, /*downPayment*/ ctx[1]);
    			append(div6, t7);
    			append(div6, div2);
    			append(div2, label2);
    			append(div2, t9);
    			append(div2, input2);
    			set_input_value(input2, /*principle*/ ctx[5]);
    			append(div6, t10);
    			append(div6, div3);
    			append(div3, label3);
    			append(div3, t12);
    			append(div3, input3);
    			set_input_value(input3, /*years*/ ctx[2]);
    			append(div6, t13);
    			append(div6, div4);
    			append(div4, label4);
    			append(div4, t15);
    			append(div4, input4);
    			set_input_value(input4, /*rateInput*/ ctx[3]);
    			append(div6, t16);
    			append(div6, div5);
    			append(div5, button);
    			append(div5, t18);
    			if (if_block) if_block.m(div5, null);

    			if (!mounted) {
    				dispose = [
    					listen(input0, "input", /*input0_input_handler*/ ctx[8]),
    					listen(input1, "input", /*input1_input_handler*/ ctx[9]),
    					listen(input2, "input", /*input2_input_handler*/ ctx[10]),
    					listen(input3, "input", /*input3_input_handler*/ ctx[11]),
    					listen(input4, "input", /*input4_input_handler*/ ctx[12]),
    					listen(button, "click", /*calculatePayment*/ ctx[7])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*homeValue*/ 1 && to_number(input0.value) !== /*homeValue*/ ctx[0]) {
    				set_input_value(input0, /*homeValue*/ ctx[0]);
    			}

    			if (dirty & /*downPayment*/ 2 && to_number(input1.value) !== /*downPayment*/ ctx[1]) {
    				set_input_value(input1, /*downPayment*/ ctx[1]);
    			}

    			if (dirty & /*principle*/ 32 && to_number(input2.value) !== /*principle*/ ctx[5]) {
    				set_input_value(input2, /*principle*/ ctx[5]);
    			}

    			if (dirty & /*years*/ 4 && to_number(input3.value) !== /*years*/ ctx[2]) {
    				set_input_value(input3, /*years*/ ctx[2]);
    			}

    			if (dirty & /*rateInput*/ 8 && to_number(input4.value) !== /*rateInput*/ ctx[3]) {
    				set_input_value(input4, /*rateInput*/ ctx[3]);
    			}

    			if (/*monthlyPayment*/ ctx[4]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(div5, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(main);
    			if (if_block) if_block.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let principle;
    	const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    	let homeValue = 600000;
    	let downPayment = 100000;
    	let years = 30;
    	let rateInput = 4.5;
    	let monthlyPayment;

    	function calculatePayment() {
    		let rate = rateInput / 100 / 12;
    		let numOfPayment = years * 12;
    		$$invalidate(4, monthlyPayment = principle * rate * Math.pow(1 + rate, numOfPayment) / (Math.pow(1 + rate, numOfPayment) - 1));
    	}

    	function input0_input_handler() {
    		homeValue = to_number(this.value);
    		$$invalidate(0, homeValue);
    	}

    	function input1_input_handler() {
    		downPayment = to_number(this.value);
    		$$invalidate(1, downPayment);
    	}

    	function input2_input_handler() {
    		principle = to_number(this.value);
    		(($$invalidate(5, principle), $$invalidate(0, homeValue)), $$invalidate(1, downPayment));
    	}

    	function input3_input_handler() {
    		years = to_number(this.value);
    		$$invalidate(2, years);
    	}

    	function input4_input_handler() {
    		rateInput = to_number(this.value);
    		$$invalidate(3, rateInput);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*homeValue, downPayment*/ 3) {
    			$$invalidate(5, principle = homeValue - downPayment);
    		}
    	};

    	return [
    		homeValue,
    		downPayment,
    		years,
    		rateInput,
    		monthlyPayment,
    		principle,
    		formatter,
    		calculatePayment,
    		input0_input_handler,
    		input1_input_handler,
    		input2_input_handler,
    		input3_input_handler,
    		input4_input_handler
    	];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
