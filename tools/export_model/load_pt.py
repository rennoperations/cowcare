"""Load a PyTorch state_dict (.pt zip) without torch, returning numpy arrays."""
import pickle, zipfile, sys
import numpy as np

DT = {
    "FloatStorage": np.float32, "HalfStorage": np.float16, "DoubleStorage": np.float64,
    "LongStorage": np.int64, "IntStorage": np.int32, "BoolStorage": np.bool_,
}


class _Storage:
    def __init__(self, dtype, key):
        self.dtype, self.key = dtype, key


def load_state_dict(path):
    z = zipfile.ZipFile(path)
    prefix = z.namelist()[0].split("/")[0]
    cache = {}

    def get_storage(st):
        if st.key not in cache:
            raw = z.read(f"{prefix}/data/{st.key}")
            cache[st.key] = np.frombuffer(raw, dtype=st.dtype)
        return cache[st.key]

    def rebuild_tensor_v2(storage, offset, size, stride, *args):
        buf = get_storage(storage)
        if len(size) == 0:
            return buf[offset:offset + 1].reshape(()).copy()
        itemsize = buf.itemsize
        arr = np.lib.stride_tricks.as_strided(
            buf[offset:], shape=tuple(size), strides=tuple(s * itemsize for s in stride))
        return np.array(arr)

    class U(pickle.Unpickler):
        def find_class(self, module, name):
            if module == "torch._utils" and name == "_rebuild_tensor_v2":
                return rebuild_tensor_v2
            if module == "torch" and name in DT:
                return name
            if module == "collections" and name == "OrderedDict":
                import collections
                return collections.OrderedDict
            if module == "torch._utils" and name == "_rebuild_parameter":
                return lambda data, req, hooks: data
            raise pickle.UnpicklingError(f"blocked {module}.{name}")

        def persistent_load(self, pid):
            # ('storage', storage_type, key, location, numel)
            _, stype, key, _loc, _n = pid
            return _Storage(DT[stype], key)

    with z.open(f"{prefix}/data.pkl") as f:
        return U(f).load()


if __name__ == "__main__":
    sd = load_state_dict(sys.argv[1])
    tot = 0
    for k, v in sd.items():
        tot += v.size if v.dtype != np.int64 else 0
        print(k, v.shape, v.dtype)
    print("params", tot)
