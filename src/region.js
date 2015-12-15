// Region
// ------

import _ from 'underscore';
import Backbone from 'backbone';
import isNodeAttached from './utils/isNodeAttached';
import MarionetteObject from './object';
import MarionetteError from './error';
import MonitorViewEvents from './monitor-view-events';
import { triggerMethodOnCond } from './trigger-method';

const Region = MarionetteObject.extend({
  cidPrefix: 'mnr',
  triggerAttach: true,
  triggerDetach: true,

  constructor(options) {
    this._setOptions(options);
    this.el = this.getOption('el');

    // Handle when this.el is passed in as a $ wrapped element.
    this.el = this.el instanceof Backbone.$ ? this.el[0] : this.el;

    if (!this.el) {
      throw new MarionetteError({
        name: 'NoElError',
        message: 'An "el" must be specified for a region.'
      });
    }

    this.$el = this.getEl(this.el);
    MarionetteObject.call(this, options);
  },

  // Displays a backbone view instance inside of the region. Handles calling the `render`
  // method for you. Reads content directly from the `el` attribute. The `preventDestroy`
  // option can be used to prevent a view from the old view being destroyed on show.
  show(view, options) {
    if (!this._ensureElement()) {
      return;
    }
    this._ensureView(view);
    if (view === this.currentView) { return this; }

    this.triggerMethod('before:show', view, this, options);

    MonitorViewEvents(view);

    this.empty(options);

    // We need to listen for if a view is destroyed in a way other than through the region.
    // If this happens we need to remove the reference to the currentView since once a view
    // has been destroyed we can not reuse it.
    view.once('destroy', this.empty, this);

    // Make this region the view's parent.
    // It's important that this parent binding happens before rendering so that any events
    // the child may trigger during render can also be triggered on the child's ancestor views.
    view._parent = this;

    this._renderView(view);

    this._attachView(view, options);

    this.triggerMethod('show', view, this, options);
    return this;
  },

  _renderView(view) {
    if (view._isRendered) {
      return;
    }

    triggerMethodOnCond(!view.supportsRenderLifecycle, view, 'before:render', view);

    view.render();

    triggerMethodOnCond(!view.supportsRenderLifecycle, view, 'render', view);
  },

  _attachView(view, options={}) {
    const shouldTriggerAttach = options.triggerAttach !== false && this.triggerAttach && isNodeAttached(this.el);
    const shouldReplaceEl = !!options.replaceElement;

    triggerMethodOnCond(shouldTriggerAttach, view, 'before:attach', view);

    this.attachHtml(view, shouldReplaceEl);

    triggerMethodOnCond(shouldTriggerAttach, view, 'attach', view);
    this.currentView = view;
  },

  _ensureElement() {
    if (!_.isObject(this.el)) {
      this.$el = this.getEl(this.el);
      this.el = this.$el[0];
    }

    if (!this.$el || this.$el.length === 0) {
      if (this.getOption('allowMissingEl')) {
        return false;
      } else {
        throw new MarionetteError('An "el" ' + this.$el.selector + ' must exist in DOM');
      }
    }
    return true;
  },

  _ensureView(view) {
    if (!view) {
      throw new MarionetteError({
        name: 'ViewNotValid',
        message: 'The view passed is undefined and therefore invalid. You must pass a view instance to show.'
      });
    }

    if (view._isDestroyed) {
      throw new MarionetteError({
        name: 'ViewDestroyedError',
        message: 'View (cid: "' + view.cid + '") has already been destroyed and cannot be used.'
      });
    }
  },

  // Override this method to change how the region finds the DOM element that it manages. Return
  // a jQuery selector object scoped to a provided parent el or the document if none exists.
  getEl(el) {
    return Backbone.$(el, this.getValue(this.getOption('parentEl')));
  },

  _replaceEl(view) {
    // always restore the el to ensure the regions el is present before replacing
    this._restoreEl();

    const parent = this.el.parentNode;

    parent.replaceChild(view.el, this.el);
    this._isReplaced = true;
  },

  // Restore the region's element in the DOM.
  _restoreEl() {
    if (!this.currentView) {
      return;
    }

    const view = this.currentView;
    const parent = view.el.parentNode;

    if (!parent) {
      return;
    }

    parent.replaceChild(this.el, view.el);
    this._isReplaced = false;
  },

  // Override this method to change how the new view is appended to the `$el` that the
  // region is managing
  attachHtml(view, shouldReplace) {
    if (shouldReplace) {
      // replace the region's node with the view's node
      this._replaceEl(view);
    } else {
      // empty the node and append new view
      this.$el.contents().detach();

      this.el.appendChild(view.el);
    }
  },

  // Destroy the current view, if there is one. If there is no current view, it does
  // nothing and returns immediately.
  empty(options) {
    const { preventDestroy } = options || {};
    const shouldPreventDestroy = !!preventDestroy;
    const view = this.currentView;

    // If there is no view in the region we should not remove anything
    if (!view) { return this; }

    view.off('destroy', this.empty, this);
    this.triggerMethod('before:empty', view);

    if (this._isReplaced) {
      this._restoreEl();
    }

    if (shouldPreventDestroy) {
      this._detachView(options);
    } else {
      this._destroyView(options);
    }

    delete this.currentView._parent;
    delete this.currentView;

    this.triggerMethod('empty', view);
    return this;
  },

  _detachView(options) {
    const { triggerDetach } = options || {};
    const view = this.currentView;
    const shouldTriggerDetach = triggerDetach !== false && !this.triggerDetach && view.isAttached();

    triggerMethodOnCond(shouldTriggerDetach, view, 'before:detach', view);

    this.$el.contents().detach();

    triggerMethodOnCond(shouldTriggerDetach, view, 'detach', view);
  },

  // Call 'destroy' or 'remove', depending on which is found on the view (if showing a raw
  // Backbone view or a Marionette View)
  _destroyView(options) {
    const view = this.currentView;
    if (view._isDestroyed) { return; }

    const shouldTriggerDetach = options.triggerDetach !== false && !this.triggerDetach && view.isAttached();

    triggerMethodOnCond(!view.supportsDestroyLifecycle, view, 'before:destroy', view);
    triggerMethodOnCond(shouldTriggerDetach, view, 'before:detach', view);

    if (view.destroy) {
      view.destroy();
    } else {
      view.remove();

      // appending _isDestroyed to raw Backbone View allows regions to throw a ViewDestroyedError
      // for this view
      view._isDestroyed = true;
    }

    triggerMethodOnCond(shouldTriggerDetach, view, 'detach', view);
    triggerMethodOnCond(!view.supportsDestroyLifecycle, view, 'destroy', view);
  },

  // Checks whether a view is currently present within the region. Returns `true` if there is
  // and `false` if no view is present.
  hasView() {
    return !!this.currentView;
  },

  // Reset the region by destroying any existing view and clearing out the cached `$el`.
  // The next time a view is shown via this region, the region will re-query the DOM for
  // the region's `el`.
  reset() {
    this.empty();

    if (this.$el) {
      this.el = this.$el.selector;
    }

    delete this.$el;
    return this;
  },

  isReplaced() {
    return !!this._isReplaced;
  }
});

export default Region;
